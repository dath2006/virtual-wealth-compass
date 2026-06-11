package com.productivityapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

// ─────────────────────────────────────────────────────────────────────────────
// SmsBroadcastReceiver.kt
//
// Catches bank SMS debits — the fallback channel for UPI events.
// Indian banks are RBI-mandated to send SMS for every debit transaction.
// This catches payments made via web browsers, bank transfers, and any
// payment method that doesn't generate an app notification.
//
// Works alongside UpiNotificationListener — DeduplicationCache prevents
// double-counting the same transaction from both channels.
// ─────────────────────────────────────────────────────────────────────────────
class SmsBroadcastReceiver : BroadcastReceiver() {

    private val scope = CoroutineScope(Dispatchers.IO)

    // RBI-mandated format: "Your A/c XXXX1234 is debited for INR 500.00 on..."
    // Covers SBI, HDFC, ICICI, Axis, Kotak, PNB, and most other Indian banks
    private val AMOUNT_REGEX = Regex(
        """(?:Rs\.?\s*|INR\s*|₹\s*)([\d,]+(?:\.\d{1,2})?)""",
        RegexOption.IGNORE_CASE
    )

    private val DEBIT_KEYWORDS = listOf(
        "debited", "deducted", "paid", "charged", "spent",
        "dr ", " dr.", "withdrawn", "transfer", "transferred",
        "sent", "payment"
    )

    // Bank SMS senders follow TRAI alphanumeric format: XX-BANKID-S
    // e.g. "SB-SBIINB-S", "AD-HDFCBK-S", "AX-ICICIB-S"
    // Nothing Phone and other custom OS might strip the prefix (e.g. "SBIINB-S" or "SBIINB" directly)
    private val BANK_SENDER_REGEX = Regex("""^(?:[A-Z]{2}-)?[A-Z0-9]{3,10}(?:-[A-Z])?$""", RegexOption.IGNORE_CASE)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        val dedup = DeduplicationCache(context)

        for (sms in messages) {
            val sender = sms.originatingAddress ?: continue
            val body   = sms.messageBody        ?: continue

            // Only process SMS from bank senders (alphanumeric format)
            if (!sender.matches(BANK_SENDER_REGEX)) continue

            // Must contain a debit keyword
            val isDebit = DEBIT_KEYWORDS.any { body.contains(it, ignoreCase = true) }
            if (!isDebit) continue

            val amount = parseAmount(body) ?: continue
            val dedupKey = dedup.buildKey(amount)

            if (!dedup.checkAndMark(dedupKey)) {
                Log.d("SmsSMS", "Duplicate SMS skipped: ₹$amount from $sender")
                continue
            }

            Log.i("SmsSMS", "Bank SMS debit: ₹$amount from $sender")

            scope.launch {
                try {
                    val envelope = EventEnvelope(
                        deviceId  = BuildConfig.DEVICE_ID,
                        eventType = EventType.UPI_DEBIT.name,
                        payload   = UpiDebitPayload(
                            amountRupees = amount,
                            merchantName = extractMerchant(body),
                            rawText      = body.take(300),
                            source       = UpiSource.SMS,
                            dedupKey     = dedupKey
                        )
                    )
                    val response = ApiClient.get().sendUpiDebit(envelope)
                    response.body()?.notification?.let {
                        NotificationHelper.showFromServer(context, it)
                    }
                } catch (e: Exception) {
                    Log.e("SmsSMS", "VPS unreachable: ${e.message}")
                    OfflineQueue(context).enqueue(EventType.UPI_DEBIT.name,
                        UpiDebitPayload(amount, extractMerchant(body),
                            body.take(300), UpiSource.SMS, dedupKey))
                }
            }
        }
    }

    private fun parseAmount(text: String): Int? {
        return AMOUNT_REGEX.find(text)
            ?.groupValues?.get(1)
            ?.replace(",", "")
            ?.toDoubleOrNull()
            ?.toInt()
            ?.takeIf { it in 1..500_000 }
    }

    // Extract merchant/payee from common bank SMS formats
    // "INR 500 paid to SWIGGY" → "SWIGGY"
    // "You paid Rs.250 at Amazon" → "Amazon"
    private fun extractMerchant(body: String): String? {
        val patterns = listOf(
            Regex("""paid to\s+([A-Za-z0-9 &]{2,30})""", RegexOption.IGNORE_CASE),
            Regex("""to\s+VPA\s+[\w.]+@([\w]+)""", RegexOption.IGNORE_CASE), // UPI VPA
            Regex("""to\s+([A-Za-z0-9 &]{2,30})""", RegexOption.IGNORE_CASE),
            Regex("""towards\s+([A-Za-z0-9 &]{2,30})""", RegexOption.IGNORE_CASE),
            Regex("""at\s+([A-Za-z0-9 &]{2,30})\s+on""", RegexOption.IGNORE_CASE)
        )
        return patterns.firstNotNullOfOrNull { it.find(body)?.groupValues?.get(1)?.trim() }
    }
}
