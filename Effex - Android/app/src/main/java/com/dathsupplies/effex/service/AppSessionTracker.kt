package com.dathsupplies.effex.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import com.dathsupplies.effex.EffexApp
import com.dathsupplies.effex.core.api.ApiClient
import com.dathsupplies.effex.core.data.*
import com.dathsupplies.effex.core.data.PrefsStore
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Publishes real-time live session state for the UI (active distraction + elapsed time). */
object LiveSessionState {
    data class Session(
        val packageName: String,
        val appLabel: String,
        val startedAtMs: Long,
        val elapsedMs: Long = 0L
    )
    private val _session = MutableStateFlow<Session?>(null)
    val session: StateFlow<Session?> = _session

    fun update(s: Session?) { _session.value = s }
}

class AppSessionTracker : AccessibilityService() {

    companion object {
        private val DEFAULT_TRACKED = setOf(
            "com.instagram.android",
            "com.twitter.android",
            "com.zhiliaoapp.musically",
            "com.snapchat.android",
            "com.reddit.frontpage",
            "com.facebook.katana",
            "com.google.android.youtube",
            "com.linkedin.android",
            "com.netflix.mediaclient",
        )
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var currentPackage: String? = null
    private var currentLabel: String?   = null
    private var sessionStartMs: Long    = 0L
    private var tickJob: Job?           = null

    override fun onServiceConnected() {
        serviceInfo = (serviceInfo ?: AccessibilityServiceInfo()).also { info ->
            info.eventTypes     = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            info.feedbackType   = AccessibilityServiceInfo.FEEDBACK_GENERIC
            info.notificationTimeout = 100
        }
        Log.i("SessionTracker", "Connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val newPkg = event.packageName?.toString() ?: return
        if (newPkg == currentPackage) return

        val oldPkg   = currentPackage
        val oldLabel = currentLabel
        val oldStart = sessionStartMs

        if (isTracked(newPkg)) {
            currentPackage  = newPkg
            currentLabel    = getLabel(newPkg)
            sessionStartMs  = System.currentTimeMillis()
            startTick()
        } else {
            currentPackage = null
            currentLabel   = null
            tickJob?.cancel()
            LiveSessionState.update(null)
        }

        if (oldPkg != null && isTracked(oldPkg)) {
            val durationMin = (System.currentTimeMillis() - oldStart) / 60_000f
            if (durationMin >= 0.1f) {
                sendSession(oldPkg, oldLabel ?: oldPkg, durationMin, oldStart)
            }
        }
    }

    override fun onInterrupt() {
        tickJob?.cancel()
        LiveSessionState.update(null)
    }

    override fun onUnbind(intent: Intent?): Boolean {
        val pkg   = currentPackage ?: return super.onUnbind(intent)
        val label = currentLabel ?: pkg
        val dur   = (System.currentTimeMillis() - sessionStartMs) / 60_000f
        if (dur > 0.1f) sendSession(pkg, label, dur, sessionStartMs)
        tickJob?.cancel()
        LiveSessionState.update(null)
        return super.onUnbind(intent)
    }

    // Every second, update the live state so the UI can display elapsed time
    private fun startTick() {
        tickJob?.cancel()
        tickJob = scope.launch {
            while (isActive && currentPackage != null) {
                val pkg   = currentPackage ?: break
                val label = currentLabel ?: pkg
                val now   = System.currentTimeMillis()
                LiveSessionState.update(
                    LiveSessionState.Session(pkg, label, sessionStartMs, now - sessionStartMs)
                )
                delay(1_000)
            }
        }
    }

    private fun sendSession(pkg: String, label: String, durationMin: Float, startedAtMs: Long) {
        scope.launch {
            try {
                if (!ApiClient.isReady()) return@launch
                val prefs = PrefsStore(applicationContext)
                val resp  = ApiClient.get().sendUsageSession(
                    EventEnvelope(
                        deviceId  = prefs.getDeviceId(),
                        eventType = EventType.USAGE_SESSION.name,
                        payload   = UsageSessionPayload(pkg, label, durationMin, startedAtMs)
                    )
                )
                resp.body()?.notification?.let { push ->
                    EffexApp.notify(applicationContext, push)
                }
            } catch (e: Exception) {
                Log.w("SessionTracker", "Send failed: ${e.message}")
                EffexApp.offlineQueue?.enqueue(
                    EventType.USAGE_SESSION.name,
                    UsageSessionPayload(pkg, label, durationMin, startedAtMs)
                )
            }
        }
    }

    private fun isTracked(pkg: String) = DEFAULT_TRACKED.contains(pkg)

    private fun getLabel(pkg: String) = try {
        val pm   = applicationContext.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) { pkg.substringAfterLast(".") }
}
