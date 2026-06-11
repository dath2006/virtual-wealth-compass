package com.productivityapp

import android.app.usage.UsageStatsManager
import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// ─────────────────────────────────────────────────────────────────────────────
// UsageTracker.kt
//
// Reads app foreground usage from UsageStatsManager and sends batched
// reports to the VPS every 30 minutes.
//
// IMPORTANT: Requires PACKAGE_USAGE_STATS permission.
// This is NOT a runtime permission — it must be granted manually in:
// Settings → Apps → Special App Access → Usage Access
// The PermissionSetupActivity guides the user there.
//
// The VPS applies the distraction pricing rules — Android just reports raw
// minutes per package.
// ─────────────────────────────────────────────────────────────────────────────
class UsageTracker(private val context: Context) {

    // System packages to always exclude from reports
    private val SYSTEM_PACKAGES_BLOCKLIST = setOf(
        "android",
        "com.android.systemui",
        "com.android.settings",
        "com.android.launcher3",
        "com.nothing.launcher",     // Nothing Phone launcher
        "com.google.android.gms",
        "com.google.android.gsf",
        context.packageName         // exclude our own app
    )

    // Collect usage stats since lastReportMs and send to VPS
    suspend fun collectAndSend(lastReportMs: Long) = withContext(Dispatchers.IO) {
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

        val now = System.currentTimeMillis()
        val stats = usm.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            lastReportMs,
            now
        )

        if (stats.isNullOrEmpty()) {
            Log.w("UsageTracker", "No usage stats returned — permission may be missing")
            return@withContext
        }

        val activePass = (context as? MainForegroundService)?.getActivePass()

        // Filter system packages and build app usage entries
        val appUsages = stats
            .filter { it.packageName !in SYSTEM_PACKAGES_BLOCKLIST }
            .filter { it.totalTimeInForeground > 60_000 }  // skip apps used <1 min
            .map { stat ->
                val packageName = stat.packageName
                val rawMinutes = (stat.totalTimeInForeground / 60_000).toInt()
                val minutesUsed = if (activePass != null && isPassCoveringApp(activePass, packageName)) {
                    if (activePass.passType == "WEEKEND_MODE") {
                        rawMinutes / 2
                    } else {
                        0
                    }
                } else {
                    rawMinutes
                }
                AppUsageEntry(
                    packageName = packageName,
                    appLabel    = getAppLabel(packageName),
                    minutesUsed = minutesUsed
                )
            }
            .filter { it.minutesUsed > 0 }
            .sortedByDescending { it.minutesUsed }
            .take(30)  // top 30 apps — enough for distraction tracking

        if (appUsages.isEmpty()) return@withContext

        Log.i("UsageTracker", "Sending usage report: ${appUsages.size} apps, " +
              "top: ${appUsages.firstOrNull()?.appLabel} ${appUsages.firstOrNull()?.minutesUsed}min")

        try {
            val envelope = EventEnvelope(
                deviceId  = BuildConfig.DEVICE_ID,
                eventType = EventType.USAGE_REPORT.name,
                payload   = UsageReportPayload(
                    periodStartMs = lastReportMs,
                    periodEndMs   = now,
                    appUsages     = appUsages
                )
            )
            ApiClient.get().sendUsageReport(envelope)
        } catch (e: Exception) {
            Log.e("UsageTracker", "Failed to send usage report: ${e.message}")
            OfflineQueue(context).enqueue(EventType.USAGE_REPORT.name,
                UsageReportPayload(lastReportMs, now, appUsages))
        }
    }

    fun hasPermission(): Boolean {
        val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val now = System.currentTimeMillis()
        val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 1000, now)
        return !stats.isNullOrEmpty()
    }

    private fun isPassCoveringApp(pass: ActivePassInfo, packageName: String): Boolean {
        val now = System.currentTimeMillis()
        if (pass.expiresAtMs != null && now > pass.expiresAtMs) return false

        return when (pass.passType) {
            "MOVIE"   -> packageName in setOf(
                "com.netflix.mediaclient",
                "com.google.android.youtube",
                "com.amazon.avod.thirdpartyclient",
                "com.hotstar.android"
            )
            "GAMING"  -> packageName in setOf(
                "com.supercell.clashofclans",
                "com.pubg.imobile",
                "com.activision.callofduty.shooter"
            )
            "BINGE"   -> packageName in setOf(
                "com.netflix.mediaclient",
                "com.google.android.youtube",
                "com.amazon.avod.thirdpartyclient",
                "com.hotstar.android",
                "com.disney.disneyplus"
            )
            "NAP"           -> true  // NAP suspends ALL drain
            "WEEKEND_MODE"  -> true  // halved drain
            "VACATION_MODE" -> true  // fully suspended
            else            -> false
        }
    }

    private fun getAppLabel(packageName: String): String {
        return try {
            val pm   = context.packageManager
            val info = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(info).toString()
        } catch (e: Exception) { packageName }
    }
}
