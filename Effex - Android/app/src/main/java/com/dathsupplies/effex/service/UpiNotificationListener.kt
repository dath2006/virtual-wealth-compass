package com.dathsupplies.effex.service

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.dathsupplies.effex.EffexApp
import com.dathsupplies.effex.core.api.ApiClient
import com.dathsupplies.effex.core.data.*
import com.dathsupplies.effex.core.data.PrefsStore
import com.dathsupplies.effex.core.util.DeduplicationCache
import kotlinx.coroutines.*

class UpiNotificationListener : NotificationListenerService() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val dedup by lazy { DeduplicationCache() }

    private val UPI_PACKAGES = setOf(
        "indwin.c3.shareapp", "com.phonepe.app",
        "com.google.android.apps.nbu.paisa.user", "net.one97.paytm",
        "com.amazon.mShop.android.shopping", "in.org.npci.upiapp",
        "com.freecharge.android", "com.mobikwik_new",
        "com.sbi.lotusintouch", "com.csam.icici.bank.imobile",
        "com.snapwork.hdfc", "com.axis.mobile", "com.kotak.mobilebanking"
    )

    private val AMOUNT_REGEX = Regex(
        """(?:Rs\.?\s*|INR\s*|₹\s*)([\d,]+(?:\.\d{1,2})?)""",
        RegexOption.IGNORE_CASE
    )
    private val DEBIT_KEYWORDS = listOf(
        "debited", "paid", "spent", "deducted", "charged",
        "payment of", "transferred to", "sent to"
    )
    private val MERCHANT_REGEX = Regex(
        """(?:paid to|to|at)\s+([A-Za-z0-9][A-Za-z0-9 &._-]{1,30})""",
        RegexOption.IGNORE_CASE
    )

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName !in UPI_PACKAGES) return
        val extras  = sbn.notification.extras
        val full    = "${extras.getString("android.title") ?: ""} ${extras.getString("android.text") ?: ""}"
        if (DEBIT_KEYWORDS.none { full.contains(it, ignoreCase = true) }) return

        val amount   = parseAmount(full) ?: return
        val merchant = MERCHANT_REGEX.find(full)?.groupValues?.get(1)?.trim()
        val key      = dedup.buildKey(amount)
        if (!dedup.checkAndMark(key)) return

        Log.i("UpiListener", "Debit: ₹$amount → $merchant")

        scope.launch {
            try {
                if (!ApiClient.isReady()) return@launch
                val prefs = PrefsStore(applicationContext)
                val resp  = ApiClient.get().sendUpiDebit(
                    EventEnvelope(
                        deviceId  = prefs.getDeviceId(),
                        eventType = EventType.UPI_DEBIT.name,
                        payload   = UpiDebitPayload(amount, merchant, full.take(300),
                                       UpiSource.NOTIFICATION, key)
                    )
                )
                resp.body()?.notification?.let { EffexApp.notify(applicationContext, it) }
            } catch (e: Exception) {
                Log.e("UpiListener", "Send failed: ${e.message}")
                EffexApp.offlineQueue?.enqueue(EventType.UPI_DEBIT.name,
                    UpiDebitPayload(amount, merchant, full.take(300), UpiSource.NOTIFICATION, key))
            }
        }
    }

    private fun parseAmount(text: String): Int? =
        AMOUNT_REGEX.find(text)?.groupValues?.get(1)
            ?.replace(",", "")?.toDoubleOrNull()?.toInt()
            ?.takeIf { it in 1..500_000 }

    override fun onNotificationRemoved(sbn: StatusBarNotification) = Unit
}
