package com.productivityapp

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import java.util.concurrent.TimeUnit

// ─────────────────────────────────────────────────────────────────────────────
// MainForegroundService.kt
//
// The heartbeat of the thin client. A foreground service is the only reliable
// way to keep background tasks running on Android — especially on Nothing Phone
// OS which aggressively kills background processes.
//
// This service:
//   1. Keeps itself visible via a persistent notification (required for foreground)
//   2. Sends a heartbeat to VPS every 15 minutes
//   3. Triggers UsageTracker.collectAndSend() every 30 minutes
//   4. Triggers StepTracker.syncSteps() every 2 hours
//   5. Drains the OfflineQueue whenever network is available
//
// The UPI notification listener and SMS receiver are separate Android system
// components — they work independently and don't need this service to be alive.
// This service only handles the scheduled polling tasks.
// ─────────────────────────────────────────────────────────────────────────────
class MainForegroundService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private val usageTracker by lazy { UsageTracker(this) }
    private val stepTracker  by lazy { StepTracker(this) }
    private val offlineQueue by lazy { OfflineQueue(this) }

    private var lastUsageReportMs = 0L
    private var lastStepSyncMs    = 0L
    private var serviceStartMs    = 0L
    private var activePass: ActivePassInfo? = null

    fun getActivePass(): ActivePassInfo? = activePass

    companion object {
        const val CHANNEL_ID   = "productivity_service"
        const val NOTIF_ID     = 1001
        const val NOTIF_BANKRUPT_ID = 1002

        fun start(context: Context) {
            val intent = Intent(context, MainForegroundService::class.java)
            context.startForegroundService(intent)
        }
    }

    override fun onCreate() {
        super.onCreate()
        serviceStartMs = SystemClock.elapsedRealtime()
        createNotificationChannel()
        startForeground(NOTIF_ID, buildPersistentNotification("Economy active"))

        // Initialise API client with build config values
        ApiClient.init(
            baseUrl = BuildConfig.VPS_BASE_URL,
            apiKey  = BuildConfig.API_SECRET_KEY
        )

        Log.i("MainService", "Foreground service started")
        startHeartbeatLoop()
    }

    private fun startHeartbeatLoop() {
        scope.launch {
            while (isActive) {
                try {
                    val now = System.currentTimeMillis()
                    val uptime = SystemClock.elapsedRealtime() - serviceStartMs

                    // ── Heartbeat (every 15 min) ──────────────────────────
                    sendHeartbeat(uptime)

                    // ── Usage report (every 30 min) ───────────────────────
                    if (now - lastUsageReportMs >= TimeUnit.MINUTES.toMillis(30)) {
                        usageTracker.collectAndSend(
                            lastReportMs = if (lastUsageReportMs == 0L) now - TimeUnit.HOURS.toMillis(1)
                                           else lastUsageReportMs
                        )
                        lastUsageReportMs = now
                    }

                    // ── Step sync (every 2 hours) ─────────────────────────
                    if (now - lastStepSyncMs >= TimeUnit.HOURS.toMillis(2)) {
                        stepTracker.syncSteps()
                        lastStepSyncMs = now
                    }

                    // ── Drain offline queue if network available ───────────
                    if (isNetworkAvailable()) {
                        offlineQueue.drainToServer(this@MainForegroundService)
                    }

                } catch (e: Exception) {
                    Log.e("MainService", "Heartbeat loop error: ${e.message}")
                }

                delay(TimeUnit.MINUTES.toMillis(15))
            }
        }
    }

    private suspend fun sendHeartbeat(uptimeMs: Long) {
        try {
            val envelope = EventEnvelope(
                deviceId  = BuildConfig.DEVICE_ID,
                eventType = EventType.HEARTBEAT.name,
                payload   = HeartbeatPayload(
                    batteryPct      = getBatteryPct(),
                    isCharging      = isCharging(),
                    serviceUptimeMs = uptimeMs
                )
            )
            val response = ApiClient.get().sendHeartbeat(envelope)

            response.body()?.let { ack ->
                activePass = ack.activePass
                
                val balance = ack.balance ?: 0
                val streak = ack.streak ?: 0
                val pass = ack.activePass
                
                val notifText = when {
                    pass != null && pass.msRemaining != null -> {
                        val mins = pass.msRemaining / 60000
                        "${if (pass.passType == "MOVIE") "🎬" else if (pass.passType == "GAMING") "🎮" else if (pass.passType == "BINGE") "📺" else if (pass.passType == "NAP") "😴" else "🎟️"} ${pass.passType} active — ${mins}m remaining"
                    }
                    balance < 0 -> "⚠ Bankrupt — ₹${Math.abs(balance)} debt"
                    else -> "Balance: ₹${balance} · Streak: ${streak} days"
                }

                if (ack.notification != null) {
                    val push = ack.notification
                    if (push.priority == "bankrupt") {
                        showBankruptNotification(push.body)
                    } else {
                        updatePersistentNotification(push.body)
                    }
                } else {
                    updatePersistentNotification(notifText)
                }
            }
        } catch (e: Exception) {
            Log.w("MainService", "Heartbeat failed: ${e.message}")
        }
    }

    // ── Notification helpers ──────────────────────────────────────────────────

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Productivity Economy",
            NotificationManager.IMPORTANCE_LOW  // silent, no sound
        ).apply {
            description = "Tracks your virtual economy in the background"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildPersistentNotification(status: String): Notification {
        val openApp = PendingIntent.getActivity(
            this, 0,
            Intent(this, PermissionSetupActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Productivity Economy")
            .setContentText(status)
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updatePersistentNotification(status: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIF_ID, buildPersistentNotification(status))
    }

    private fun showBankruptNotification(debtInfo: String) {
        val nm = getSystemService(NotificationManager::class.java)
        val notif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("⚠ You're bankrupt!")
            .setContentText(debtInfo)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setOngoing(true)  // non-dismissable
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        nm.notify(NOTIF_BANKRUPT_ID, notif)
    }

    // ── System helpers ────────────────────────────────────────────────────────

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

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // START_STICKY: system restarts the service if killed
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
        Log.w("MainService", "Service destroyed — will restart via STICKY")
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

// Boot receiver — restarts the service after phone reboot
class BootReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.i("BootReceiver", "Boot complete — starting MainForegroundService")
        MainForegroundService.start(context)
    }
}
