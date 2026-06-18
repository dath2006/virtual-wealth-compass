package com.dathsupplies.effex.service

import android.app.usage.UsageStatsManager
import android.content.Context
import android.util.Log
import com.dathsupplies.effex.core.api.ApiClient
import com.dathsupplies.effex.core.data.*
import com.dathsupplies.effex.core.data.PrefsStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class UsageTracker(private val context: Context) {

    private val BLOCKLIST = setOf(
        "android", "com.android.systemui", "com.android.settings",
        "com.android.launcher3", "com.nothing.launcher", "com.google.android.gms",
        "com.google.android.gsf", context.packageName
    )

    suspend fun collectAndSend(lastReportMs: Long) = withContext(Dispatchers.IO) {
        if (!ApiClient.isReady()) return@withContext
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val now = System.currentTimeMillis()
        val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, lastReportMs, now)

        if (stats.isNullOrEmpty()) {
            Log.w("UsageTracker", "No stats — usage permission missing?")
            return@withContext
        }

        val entries = stats
            .filter { it.packageName !in BLOCKLIST }
            .filter { it.totalTimeInForeground > 60_000 }
            .map { AppUsageEntry(it.packageName, getLabel(it.packageName), (it.totalTimeInForeground / 60_000).toInt()) }
            .filter { it.minutesUsed > 0 }
            .sortedByDescending { it.minutesUsed }
            .take(30)

        if (entries.isEmpty()) return@withContext

        try {
            val prefs = PrefsStore(context)
            ApiClient.get().sendUsageReport(
                EventEnvelope(
                    deviceId  = prefs.getDeviceId(),
                    eventType = EventType.USAGE_REPORT.name,
                    payload   = UsageReportPayload(lastReportMs, now, entries)
                )
            )
            Log.i("UsageTracker", "Sent ${entries.size} apps")
        } catch (e: Exception) {
            Log.e("UsageTracker", "Send failed: ${e.message}")
        }
    }

    private fun getLabel(pkg: String) = try {
        context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) { pkg }
}
