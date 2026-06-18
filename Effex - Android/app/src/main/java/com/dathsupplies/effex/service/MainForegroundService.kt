package com.dathsupplies.effex.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import com.dathsupplies.effex.EffexApp
import com.dathsupplies.effex.MainActivity
import com.dathsupplies.effex.NotificationHelper
import com.dathsupplies.effex.core.api.ApiClient
import com.dathsupplies.effex.core.data.*
import com.dathsupplies.effex.core.data.PrefsStore
import kotlinx.coroutines.*
import java.util.concurrent.TimeUnit

class MainForegroundService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val usageTracker by lazy { UsageTracker(this) }
    private val stepTracker  by lazy { StepTracker(this) }

    private var lastUsageReportMs = 0L
    private var lastStepSyncMs    = 0L
    private var serviceStartMs    = 0L

    var activePass: ActivePassInfo? = null
        private set

    companion object {
        const val NOTIF_ID          = 1001
        const val NOTIF_BANKRUPT_ID = 1002

        fun start(context: Context) {
            context.startForegroundService(Intent(context, MainForegroundService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, MainForegroundService::class.java))
        }
    }

    override fun onCreate() {
        super.onCreate()
        serviceStartMs = SystemClock.elapsedRealtime()
        NotificationHelper.ensureChannels(this)
        startForeground(NOTIF_ID, buildPersistentNotif("Economy active"))

        scope.launch {
            val prefs = PrefsStore(applicationContext)
            ApiClient.init(prefs.getBaseUrl(), prefs.getApiKey())
            startHeartbeatLoop()
        }
    }

    private fun startHeartbeatLoop() {
        scope.launch {
            while (isActive) {
                try {
                    val now    = System.currentTimeMillis()
                    val uptime = SystemClock.elapsedRealtime() - serviceStartMs

                    sendHeartbeat(uptime)

                    if (now - lastUsageReportMs >= TimeUnit.MINUTES.toMillis(30)) {
                        val since = if (lastUsageReportMs == 0L) now - TimeUnit.HOURS.toMillis(1)
                                    else lastUsageReportMs
                        usageTracker.collectAndSend(since)
                        lastUsageReportMs = now
                    }

                    if (now - lastStepSyncMs >= TimeUnit.HOURS.toMillis(2)) {
                        stepTracker.syncSteps()
                        lastStepSyncMs = now
                    }

                    if (isNetworkAvailable()) {
                        EffexApp.offlineQueue?.drainToServer()
                    }
                } catch (e: Exception) {
                    Log.e("MainService", "Loop error: ${e.message}")
                }
                delay(TimeUnit.MINUTES.toMillis(15))
            }
        }
    }

    private suspend fun sendHeartbeat(uptimeMs: Long) {
        if (!ApiClient.isReady()) return
        try {
            val prefs  = PrefsStore(applicationContext)
            val devId  = prefs.getDeviceId()
            val resp   = ApiClient.get().sendHeartbeat(
                EventEnvelope(
                    deviceId  = devId,
                    eventType = EventType.HEARTBEAT.name,
                    payload   = HeartbeatPayload(
                        batteryPct      = getBatteryPct(),
                        isCharging      = isCharging(),
                        serviceUptimeMs = uptimeMs
                    )
                )
            )
            resp.body()?.let { ack ->
                activePass = ack.activePass

                val balance = ack.balance ?: 0
                val streak  = ack.streak  ?: 0
                val pass    = ack.activePass

                val statusText = when {
                    pass != null && pass.msRemaining != null -> {
                        val mins = pass.msRemaining / 60000
                        "${passEmoji(pass.passType)} ${pass.passType} active — ${mins}m left"
                    }
                    balance < 0 -> "⚠ Bankrupt — ₹${-balance} debt"
                    else        -> "₹$balance · $streak day streak"
                }

                if (ack.notification?.priority == "bankrupt") {
                    showBankruptNotif(ack.notification.body)
                } else {
                    updatePersistentNotif(statusText)
                }
            }
        } catch (e: Exception) {
            Log.w("MainService", "Heartbeat failed: ${e.message}")
        }
    }

    private fun passEmoji(passType: String) = when (passType) {
        "MOVIE"    -> "🎬"
        "GAMING"   -> "🎮"
        "BINGE"    -> "📺"
        "NAP"      -> "😴"
        "STUDY_BREAK" -> "☕"
        else       -> "🎟"
    }

    // ── Notification helpers ──────────────────────────────────────────────────

    private fun buildPersistentNotif(status: String): Notification {
        val openApp = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, NotificationHelper.CHANNEL_SERVICE)
            .setContentTitle("Effex Economy")
            .setContentText(status)
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updatePersistentNotif(status: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIF_ID, buildPersistentNotif(status))
    }

    private fun showBankruptNotif(body: String) {
        val notif = NotificationCompat.Builder(this, NotificationHelper.CHANNEL_ALERTS)
            .setContentTitle("⚠ Bankrupt!")
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        getSystemService(NotificationManager::class.java).notify(NOTIF_BANKRUPT_ID, notif)
    }

    // ── System ────────────────────────────────────────────────────────────────

    private fun getBatteryPct(): Int {
        val bm = getSystemService(Context.BATTERY_SERVICE) as android.os.BatteryManager
        return bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    private fun isCharging(): Boolean {
        val bm = getSystemService(Context.BATTERY_SERVICE) as android.os.BatteryManager
        return bm.isCharging
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        return cm.activeNetworkInfo?.isConnected == true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
