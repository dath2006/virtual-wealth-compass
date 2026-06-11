package com.productivityapp

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

// ─────────────────────────────────────────────────────────────────────────────
// UpiNotificationListener.kt
//
// Intercepts notifications from all major UPI apps and bank apps.
// Parses the ₹ amount and merchant name, then POSTs to VPS.
//
// Does NOT intercept all notifications — only from the UPI_APP_PACKAGES set.
// This keeps battery impact minimal.
// ─────────────────────────────────────────────────────────────────────────────
class UpiNotificationListener : NotificationListenerService() {

    private val scope = CoroutineScope(Dispatchers.IO)
    private val dedup by lazy { DeduplicationCache(applicationContext) }

    // All UPI apps + major bank apps that send debit notifications
    private val UPI_APP_PACKAGES = setOf(
        "indwin.c3.shareapp",                           // Slice
        "com.phonepe.app",                              // PhonePe
        "com.google.android.apps.nbu.paisa.user",       // GPay
        "net.one97.paytm",                              // Paytm
        "com.amazon.mShop.android.shopping",            // Amazon Pay
        "in.org.npci.upiapp",                           // BHIM
        "com.freecharge.android",                       // Freecharge
        "com.mobikwik_new",                             // MobiKwik
        // Major bank apps that push debit alerts
        "com.sbi.lotusintouch",                         // SBI YONO
        "com.csam.icici.bank.imobile",                  // ICICI iMobile
        "com.snapwork.hdfc",                            // HDFC MobileBanking
        "com.axis.mobile",                              // Axis Mobile
        "com.kotak.mobilebanking"                       // Kotak Mobile
    )

    // Regex patterns for extracting ₹ amount
    // Covers: "Rs.250", "INR 250.00", "₹250", "Rs 1,250.50"
    private val AMOUNT_REGEX = Regex(
        """(?:Rs\.?\s*|INR\s*|₹\s*)([\d,]+(?:\.\d{1,2})?)""",
        RegexOption.IGNORE_CASE
    )

    // Debit confirmation keywords — ensure this is a SPEND not a receive
    private val DEBIT_KEYWORDS = listOf(
        "debited", "paid", "spent", "deducted", "charged",
        "payment of", "transferred to", "sent to"
    )

    // Merchant extraction: "Paid to Swiggy via UPI" → "Swiggy"
    private val MERCHANT_REGEX = Regex(
        """(?:paid to|to|at)\s+([A-Za-z0-9][A-Za-z0-9 &._-]{1,30})""",
        RegexOption.IGNORE_CASE
    )

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // Ignore notifications from non-UPI apps immediately
        if (sbn.packageName !in UPI_APP_PACKAGES) return

        val extras = sbn.notification.extras
        val title  = extras.getString("android.title") ?: ""
        val text   = extras.getString("android.text")  ?: ""
        val full   = "$title $text"

        // Must contain a debit keyword to proceed
        val isDebit = DEBIT_KEYWORDS.any { full.contains(it, ignoreCase = true) }
        if (!isDebit) return

        val amount   = parseAmount(full) ?: return
        val merchant = parseMerchant(full)
        val dedupKey = dedup.buildKey(amount)

        // Skip if we've already seen this exact amount in the last 30 seconds
        if (!dedup.checkAndMark(dedupKey)) {
            Log.d("UpiListener", "Duplicate skipped: ₹$amount from ${sbn.packageName}")
            return
        }

        Log.i("UpiListener", "UPI debit detected: ₹$amount to $merchant via ${sbn.packageName}")

        scope.launch {
            try {
                val envelope = EventEnvelope(
                    deviceId    = BuildConfig.DEVICE_ID,
                    eventType   = EventType.UPI_DEBIT.name,
                    payload     = UpiDebitPayload(
                        amountRupees = amount,
                        merchantName = merchant,
                        rawText      = full.take(300),  // cap raw text length
                        source       = UpiSource.NOTIFICATION,
                        dedupKey     = dedupKey
                    )
                )
                val response = ApiClient.get().sendUpiDebit(envelope)
                handleAck(response.body())
            } catch (e: Exception) {
                Log.e("UpiListener", "Failed to send to VPS: ${e.message}")
                OfflineQueue(applicationContext).enqueue(EventType.UPI_DEBIT.name,
                    UpiDebitPayload(amount, merchant, full.take(300),
                        UpiSource.NOTIFICATION, dedupKey))
            }
        }
    }

    private fun parseAmount(text: String): Int? {
        return AMOUNT_REGEX.find(text)
            ?.groupValues?.get(1)
            ?.replace(",", "")
            ?.toDoubleOrNull()
            ?.toInt()
            ?.takeIf { it in 1..500_000 }  // sanity range: ₹1 – ₹5 lakh
    }

    private fun parseMerchant(text: String): String? {
        return MERCHANT_REGEX.find(text)
            ?.groupValues?.get(1)
            ?.trim()
            ?.take(50)
    }

    private fun handleAck(ack: ServerAck?) {
        ack?.notification?.let { push ->
            NotificationHelper.showFromServer(applicationContext, push)
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) { /* no-op */ }
}
