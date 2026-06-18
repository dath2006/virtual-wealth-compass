package com.dathsupplies.effex.core.data

import com.google.gson.annotations.SerializedName

// ─── Outbound: event envelope ─────────────────────────────────────────────────

data class EventEnvelope<T>(
    @SerializedName("device_id")    val deviceId: String,
    @SerializedName("timestamp_ms") val timestampMs: Long = System.currentTimeMillis(),
    @SerializedName("event_type")   val eventType: String,
    @SerializedName("payload")      val payload: T
)

enum class EventType {
    UPI_DEBIT, NFC_SESSION_START, NFC_SESSION_STOP,
    USAGE_REPORT, USAGE_SESSION, STEPS_UPDATE, HEARTBEAT
}

// ─── Event payloads ───────────────────────────────────────────────────────────

data class UpiDebitPayload(
    @SerializedName("amount_rupees")  val amountRupees: Int,
    @SerializedName("merchant_name")  val merchantName: String?,
    @SerializedName("raw_text")       val rawText: String,
    @SerializedName("source")         val source: UpiSource,
    @SerializedName("dedup_key")      val dedupKey: String
)

enum class UpiSource { NOTIFICATION, SMS }

data class NfcSessionPayload(
    @SerializedName("tag_id")    val tagId: String,
    @SerializedName("tag_label") val tagLabel: String
)

data class UsageReportPayload(
    @SerializedName("period_start_ms") val periodStartMs: Long,
    @SerializedName("period_end_ms")   val periodEndMs: Long,
    @SerializedName("app_usages")      val appUsages: List<AppUsageEntry>
)

data class AppUsageEntry(
    @SerializedName("package_name") val packageName: String,
    @SerializedName("app_label")    val appLabel: String,
    @SerializedName("minutes_used") val minutesUsed: Int
)

data class UsageSessionPayload(
    @SerializedName("package_name")  val packageName: String,
    @SerializedName("app_label")     val appLabel: String,
    @SerializedName("minutes")       val minutes: Float,
    @SerializedName("started_at_ms") val startedAtMs: Long
)

data class StepsPayload(
    @SerializedName("steps_today") val stepsToday: Long,
    @SerializedName("date")        val date: String
)

data class HeartbeatPayload(
    @SerializedName("battery_pct")       val batteryPct: Int,
    @SerializedName("is_charging")       val isCharging: Boolean,
    @SerializedName("service_uptime_ms") val serviceUptimeMs: Long
)

// ─── Server responses ─────────────────────────────────────────────────────────

data class ServerAck(
    @SerializedName("status")       val status: String,
    @SerializedName("message")      val message: String?,
    @SerializedName("notification") val notification: PushInstruction?,
    @SerializedName("active_pass")  val activePass: ActivePassInfo? = null,
    @SerializedName("balance")      val balance: Int? = null,
    @SerializedName("streak")       val streak: Int? = null,
    @SerializedName("multiplier")   val multiplier: Double? = null
)

data class ActivePassInfo(
    @SerializedName("pass_id")       val passId: Int,
    @SerializedName("pass_type")     val passType: String,
    @SerializedName("category")      val category: String,
    @SerializedName("expires_at_ms") val expiresAtMs: Long?,
    @SerializedName("ms_remaining")  val msRemaining: Long?
)

data class PushInstruction(
    @SerializedName("title")    val title: String,
    @SerializedName("body")     val body: String,
    @SerializedName("priority") val priority: String
)

// ─── Dashboard / read models ──────────────────────────────────────────────────

data class BalanceResponse(
    @SerializedName("balance") val balance: Int
)

data class StreakResponse(
    @SerializedName("streak") val streak: Int
)

data class LedgerEntry(
    @SerializedName("id")           val id: Int,
    @SerializedName("amount")       val amount: Int,
    @SerializedName("category")     val category: String,
    @SerializedName("description")  val description: String,
    @SerializedName("merchantName") val merchantName: String?,
    @SerializedName("spendClass")   val spendClass: String?,
    @SerializedName("status")       val status: String,
    @SerializedName("timestampMs")  val timestampMs: Long
)

data class UsageTodayResponse(
    @SerializedName("totalDrainedToday") val totalDrainedToday: Float,
    @SerializedName("apps")             val apps: List<UsageAppEntry>,
    @SerializedName("byCategory")       val byCategory: List<UsageCategoryEntry>
)

data class UsageAppEntry(
    @SerializedName("packageName")     val packageName: String,
    @SerializedName("appName")         val appName: String,
    @SerializedName("category")        val category: String,
    @SerializedName("costPerMin")      val costPerMin: Int,
    @SerializedName("surgeCostPerMin") val surgeCostPerMin: Int,
    @SerializedName("minutesToday")    val minutesToday: Int,
    @SerializedName("minutesThisMonth") val minutesThisMonth: Int
)

data class UsageCategoryEntry(
    @SerializedName("category") val category: String,
    @SerializedName("drained")  val drained: Float,
    @SerializedName("minutes")  val minutes: Int
)

data class MarketplaceCatalogueResponse(
    @SerializedName("passes")                   val passes: List<MarketplacePass>,
    @SerializedName("monthly_marketplace_spent") val monthlySpent: Int,
    @SerializedName("monthly_marketplace_cap")   val monthlyCap: Int,
    @SerializedName("current_balance")           val currentBalance: Int
)

data class MarketplacePass(
    @SerializedName("pass_type")          val passType: String,
    @SerializedName("display_name")       val displayName: String,
    @SerializedName("description")        val description: String,
    @SerializedName("category")           val category: String,
    @SerializedName("virtual_price")      val virtualPrice: Int,
    @SerializedName("duration_minutes")   val durationMinutes: Int?,
    @SerializedName("can_purchase")       val canPurchase: Boolean,
    @SerializedName("blocked_reason")     val blockedReason: String?,
    @SerializedName("guilt_tax_amount")   val guiltTaxAmount: Int,
    @SerializedName("total_price")        val totalPrice: Int,
    @SerializedName("weekly_used")        val weeklyUsed: Int,
    @SerializedName("weekly_limit")       val weeklyLimit: Int,
    @SerializedName("locked_until_streak") val lockedUntilStreak: Int?,
    @SerializedName("valid_after_hour")   val validAfterHour: Int?
)

data class PurchaseResponse(
    @SerializedName("id")          val id: Int,
    @SerializedName("pass_type")   val passType: String,
    @SerializedName("status")      val status: String,
    @SerializedName("price_paid")  val pricePaid: Int,
    @SerializedName("guilt_tax")   val guiltTax: Int,
    @SerializedName("message")     val message: String,
    @SerializedName("new_balance") val newBalance: Int
)

data class MyPassEntry(
    @SerializedName("id")              val id: Int,
    @SerializedName("pass_type")       val passType: String,
    @SerializedName("status")          val status: String,
    @SerializedName("category")        val category: String,
    @SerializedName("price_paid")      val pricePaid: Int,
    @SerializedName("purchased_at_ms") val purchasedAtMs: Long,
    @SerializedName("activated_at_ms") val activatedAtMs: Long?,
    @SerializedName("expires_at_ms")   val expiresAtMs: Long?,
    @SerializedName("ms_remaining")    val msRemaining: Long?
)

data class ActivatePassResponse(
    @SerializedName("id")               val id: Int,
    @SerializedName("pass_type")        val passType: String,
    @SerializedName("status")           val status: String,
    @SerializedName("expires_at_ms")    val expiresAtMs: Long?,
    @SerializedName("duration_minutes") val durationMinutes: Int?,
    @SerializedName("message")          val message: String
)

data class WellnessDashboard(
    @SerializedName("current_sleep")      val currentSleep: CurrentSleep,
    @SerializedName("sleep_history")      val sleepHistory: List<SleepEntry>,
    @SerializedName("exercise_history")   val exerciseHistory: List<ExerciseEntry>,
    @SerializedName("step_history")       val stepHistory: List<StepEntry>,
    @SerializedName("sleep_multiplier_today") val sleepMultiplierToday: Float
)

data class CurrentSleep(
    @SerializedName("is_sleeping")  val isSleeping: Boolean,
    @SerializedName("sleep_at_ms")  val sleepAtMs: Long?
)

data class SleepEntry(
    @SerializedName("date")           val date: String,
    @SerializedName("duration_hours") val durationHours: Float?,
    @SerializedName("quality")        val quality: String?,
    @SerializedName("multiplier")     val multiplier: Float?
)

data class ExerciseEntry(
    @SerializedName("date")             val date: String,
    @SerializedName("exercise_type")    val exerciseType: String,
    @SerializedName("duration_minutes") val durationMinutes: Float,
    @SerializedName("earned")           val earned: Int
)

data class StepEntry(
    @SerializedName("date")        val date: String,
    @SerializedName("steps")       val steps: Long,
    @SerializedName("step_income") val stepIncome: Int
)

// Exercise log request
data class ExerciseLogRequest(
    @SerializedName("exercise_type")    val exerciseType: String,
    @SerializedName("duration_minutes") val durationMinutes: Float,
    @SerializedName("started_at_ms")    val startedAtMs: Long? = null
)

data class ExerciseLogResponse(
    @SerializedName("earned")           val earned: Int,
    @SerializedName("exercise_type")    val exerciseType: String,
    @SerializedName("duration_minutes") val durationMinutes: Float,
    @SerializedName("rate_per_10_min")  val ratePerTenMin: Int
)
