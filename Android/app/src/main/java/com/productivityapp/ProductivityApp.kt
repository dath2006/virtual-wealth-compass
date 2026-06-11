package com.productivityapp

import android.app.Application
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat

// ─────────────────────────────────────────────────────────────────────────────
// ProductivityApp.kt
//
// Application class — holds the global app context and initialises
// ApiClient at launch.
// ─────────────────────────────────────────────────────────────────────────────
class ProductivityApp : Application() {

    companion object {
        lateinit var appContext: Context
            private set
        
        var offlineQueue: OfflineQueue? = null
            private set

        fun showNotification(context: Context, title: String, body: String, isHighPriority: Boolean = false) {
            val push = PushInstruction(
                title = title,
                body = body,
                priority = if (isHighPriority) "high" else "default"
            )
            NotificationHelper.showFromServer(context, push)
        }
    }

    override fun onCreate() {
        super.onCreate()
        appContext = applicationContext
        offlineQueue = OfflineQueue(this)

        // Init API client on app start so it's ready when events fire
        ApiClient.init(
            baseUrl = BuildConfig.VPS_BASE_URL,
            apiKey  = BuildConfig.API_SECRET_KEY
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// NotificationHelper.kt
//
// Shows push notifications received from the VPS in the server's ACK response.
// The server decides what to show — "Session started", "Earned ₹120",
// "You're bankrupt", etc. Android just displays it.
// ─────────────────────────────────────────────────────────────────────────────
object NotificationHelper {

    private const val CHANNEL_ALERTS = "economy_alerts"
    private var notifId = 2000

    fun showFromServer(context: Context, push: PushInstruction) {
        ensureChannel(context)

        val priority = when (push.priority) {
            "high", "bankrupt" -> NotificationCompat.PRIORITY_HIGH
            else               -> NotificationCompat.PRIORITY_DEFAULT
        }

        val notif = NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setContentTitle(push.title)
            .setContentText(push.body)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(priority)
            .setAutoCancel(true)
            .build()

        context.getSystemService(NotificationManager::class.java)
            .notify(notifId++, notif)
    }

    private fun ensureChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ALERTS) != null) return

        val channel = android.app.NotificationChannel(
            CHANNEL_ALERTS,
            "Economy Alerts",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Balance updates, session summaries, and bankruptcy alerts"
        }
        nm.createNotificationChannel(channel)
    }
}
