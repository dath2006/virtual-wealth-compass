package com.productivityapp

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.content.SharedPreferences
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * AppSessionTracker — Real-time per-app session tracker.
 *
 * Uses TYPE_WINDOW_STATE_CHANGED to detect when the user switches from a
 * tracked distraction app to any other app or home screen.
 *
 * When a distraction session ends:
 *   1. Compute duration = now - session_start_ms
 *   2. POST /events/usage_session immediately (does NOT wait for midnight)
 *   3. The server deducts the drain in real-time and pushes an SSE event
 *      to the browser dashboard.
 *
 * This entirely replaces the 24-hour batch distraction drain.
 * The existing UsageTracker batch report (every 30 min) is kept as a
 * backup / reconciliation signal only.
 *
 * DISTRACTION APPS TRACKED (matches backend DistractionRule package_names):
 * These are the default set; they should mirror what the user configures in
 * the backend settings via /settings/distraction-rules.
 */
class AppSessionTracker : AccessibilityService() {

    companion object {
        private const val TAG = "AppSessionTracker"

        // Default tracked packages — server is the authoritative source
        // but we keep a local copy so we can gate session tracking on-device
        // without a network call for every window change event.
        private val DEFAULT_TRACKED_PACKAGES = setOf(
            "com.instagram.android",
            "com.twitter.android",
            "com.zhiliaoapp.musically",   // TikTok
            "com.snapchat.android",
            "com.reddit.frontpage",
            "com.facebook.katana",
            "com.youtube.android",        // YouTube (not Netflix which is a pass)
            "com.linkedin.android",
        )
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var prefs: SharedPreferences

    // Current distraction session state
    private var currentPackage: String? = null
    private var currentAppLabel: String? = null
    private var sessionStartMs: Long = 0L

    override fun onServiceConnected() {
        prefs = applicationContext.getSharedPreferences("app_prefs", MODE_PRIVATE)
        val info = serviceInfo ?: return
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.notificationTimeout = 100
        serviceInfo = info
        Log.i(TAG, "AppSessionTracker connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val newPackage = event.packageName?.toString() ?: return
        if (newPackage == currentPackage) return   // still in same app

        val oldPackage = currentPackage
        val oldLabel   = currentAppLabel
        val oldStart   = sessionStartMs

        // ── New foreground window ───────────────────────────────────────────
        if (isTrackedPackage(newPackage)) {
            currentPackage  = newPackage
            currentAppLabel = getAppLabel(newPackage)
            sessionStartMs  = System.currentTimeMillis()
            Log.d(TAG, "Session START: $currentAppLabel ($currentPackage)")
        } else {
            // User left a tracked app (or was never in one)
            currentPackage  = null
            currentAppLabel = null
        }

        // ── End previous tracked session ───────────────────────────────────
        if (oldPackage != null && isTrackedPackage(oldPackage)) {
            val durationMs = System.currentTimeMillis() - oldStart
            val durationMin = durationMs / 60_000f

            if (durationMin < 0.1f) return   // ignore sub-6-second blips

            Log.i(TAG, "Session END: $oldLabel — ${String.format("%.1f", durationMin)} min")
            sendUsageSessionEvent(oldPackage, oldLabel ?: oldPackage, durationMin, oldStart)
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "AppSessionTracker interrupted")
    }

    override fun onUnbind(intent: Intent?): Boolean {
        // End any open session when service is destroyed
        val pkg   = currentPackage ?: return super.onUnbind(intent)
        val label = currentAppLabel ?: pkg
        val dur   = (System.currentTimeMillis() - sessionStartMs) / 60_000f
        if (dur > 0.1f) {
            sendUsageSessionEvent(pkg, label, dur, sessionStartMs)
        }
        return super.onUnbind(intent)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun isTrackedPackage(pkg: String): Boolean {
        // In a full implementation, load dynamic list from shared prefs
        // (synced from backend /settings/distraction-rules).
        // For now, use the default set.
        return DEFAULT_TRACKED_PACKAGES.contains(pkg)
    }

    private fun getAppLabel(packageName: String): String {
        return try {
            val pm   = applicationContext.packageManager
            val info = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(info).toString()
        } catch (e: Exception) {
            packageName.substringAfterLast(".")
        }
    }

    private fun sendUsageSessionEvent(
        packageName: String,
        appLabel: String,
        durationMin: Float,
        startedAtMs: Long
    ) {
        val deviceId = prefs.getString("device_id", "unknown") ?: "unknown"
        val payload = UsageSessionPayload(
            packageName = packageName,
            appLabel = appLabel,
            minutes = durationMin,
            startedAtMs = startedAtMs
        )

        scope.launch {
            try {
                val envelope = EventEnvelope(
                    deviceId    = deviceId,
                    eventType   = EventType.USAGE_SESSION.name,
                    payload     = payload,
                )
                val response = ApiClient.get().sendUsageSession(envelope)
                val ack = response.body()
                Log.d(TAG, "Usage session ack: ${ack?.status} | message=${ack?.message}")

                // Show notification if server says to (e.g. bankrupt or surge warning)
                ack?.notification?.let { push ->
                    ProductivityApp.showNotification(
                        applicationContext,
                        push.title,
                        push.body,
                        isHighPriority = push.priority == "high" || push.priority == "bankrupt"
                    )
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to send usage_session: ${e.message}")
                // Queue for replay when connectivity restores
                ProductivityApp.offlineQueue?.enqueue(EventType.USAGE_SESSION.name, payload)
            }
        }
    }
}
