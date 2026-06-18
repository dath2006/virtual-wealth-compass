package com.dathsupplies.effex

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import com.dathsupplies.effex.core.api.ApiClient
import com.dathsupplies.effex.core.data.PrefsStore
import com.dathsupplies.effex.core.data.PushInstruction
import com.dathsupplies.effex.core.util.OfflineQueue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class EffexApp : Application() {

    companion object {
        lateinit var appContext: Context    private set
        var offlineQueue: OfflineQueue? = null

        fun notify(context: Context, push: PushInstruction) {
            NotificationHelper.show(context, push)
        }
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onCreate() {
        super.onCreate()
        appContext   = applicationContext
        offlineQueue = OfflineQueue(this)

        scope.launch {
            val prefs = PrefsStore(applicationContext)
            val url   = prefs.getBaseUrl()
            val key   = prefs.getApiKey()
            if (url.isNotBlank() && key.isNotBlank()) {
                ApiClient.init(url, key)
            }
        }
    }
}

object NotificationHelper {
    const val CHANNEL_SERVICE = "effex_service"
    const val CHANNEL_ALERTS  = "effex_alerts"
    private var notifId = 3000

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)

        if (nm.getNotificationChannel(CHANNEL_SERVICE) == null) {
            nm.createNotificationChannel(NotificationChannel(
                CHANNEL_SERVICE, "Economy Engine",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Persistent background tracker"
                setShowBadge(false)
            })
        }

        if (nm.getNotificationChannel(CHANNEL_ALERTS) == null) {
            nm.createNotificationChannel(NotificationChannel(
                CHANNEL_ALERTS, "Economy Alerts",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Balance updates, session summaries, bankruptcy alerts"
            })
        }
    }

    fun show(context: Context, push: PushInstruction) {
        ensureChannels(context)
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
        context.getSystemService(NotificationManager::class.java).notify(notifId++, notif)
    }
}
