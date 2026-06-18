package com.dathsupplies.effex.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.dathsupplies.effex.EffexApp
import com.dathsupplies.effex.core.api.ApiClient
import com.dathsupplies.effex.core.data.*
import com.dathsupplies.effex.core.data.PrefsStore
import com.dathsupplies.effex.core.util.DeduplicationCache
import kotlinx.coroutines.*

class SmsBroadcastReceiver : BroadcastReceiver() {

    private val scope = CoroutineScope(Dispatchers.IO)
    private val dedup = DeduplicationCache()

    private val AMOUNT_REGEX = Regex(
        """(?:Rs\.?\s*|INR\s*|₹\s*)([\d,]+(?:\.\d{1,2})?)""",
        RegexOption.IGNORE_CASE
    )
    private val DEBIT_KEYWORDS = listOf(
        "debited","deducted","paid","charged","spent","dr ","withdrawn","transferred","sent","payment"
    )
    private val BANK_SENDER = Regex("""^(?:[A-Z]{2}-)?[A-Z0-9]{3,10}(?:-[A-Z])?$""", RegexOption.IGNORE_CASE)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return

        for (sms in messages) {
            val sender = sms.originatingAddress ?: continue
            val body   = sms.messageBody        ?: continue
            if (!sender.matches(BANK_SENDER)) continue
            if (DEBIT_KEYWORDS.none { body.contains(it, ignoreCase = true) }) continue

            val amount = parseAmount(body) ?: continue
            val key    = dedup.buildKey(amount)
            if (!dedup.checkAndMark(key)) continue

            Log.i("SmsSMS", "Bank SMS debit: ₹$amount from $sender")

            scope.launch {
                try {
                    if (!ApiClient.isReady()) return@launch
                    val prefs = PrefsStore(context)
                    val resp  = ApiClient.get().sendUpiDebit(
                        EventEnvelope(
                            deviceId  = prefs.getDeviceId(),
                            eventType = EventType.UPI_DEBIT.name,
                            payload   = UpiDebitPayload(
                                amount, extractMerchant(body), body.take(300),
                                UpiSource.SMS, key
                            )
                        )
                    )
                    resp.body()?.notification?.let { EffexApp.notify(context, it) }
                } catch (e: Exception) {
                    Log.e("SmsSMS", "Send failed: ${e.message}")
                    EffexApp.offlineQueue?.enqueue(EventType.UPI_DEBIT.name,
                        UpiDebitPayload(amount, extractMerchant(body), body.take(300), UpiSource.SMS, key))
                }
            }
        }
    }

    private fun parseAmount(text: String): Int? =
        AMOUNT_REGEX.find(text)?.groupValues?.get(1)
            ?.replace(",", "")?.toDoubleOrNull()?.toInt()
            ?.takeIf { it in 1..500_000 }

    private fun extractMerchant(body: String): String? {
        val patterns = listOf(
            Regex("""paid to\s+([A-Za-z0-9 &]{2,30})""", RegexOption.IGNORE_CASE),
            Regex("""to\s+VPA\s+[\w.]+@([\w]+)""", RegexOption.IGNORE_CASE),
            Regex("""to\s+([A-Za-z0-9 &]{2,30})""", RegexOption.IGNORE_CASE),
            Regex("""at\s+([A-Za-z0-9 &]{2,30})\s+on""", RegexOption.IGNORE_CASE)
        )
        return patterns.firstNotNullOfOrNull { it.find(body)?.groupValues?.get(1)?.trim() }
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.i("BootReceiver", "Boot complete — restarting Effex service")
        MainForegroundService.start(context)
    }
}
