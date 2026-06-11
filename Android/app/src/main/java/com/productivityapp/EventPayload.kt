package com.productivityapp

import com.google.gson.annotations.SerializedName

// ─────────────────────────────────────────────────────────────────────────────
// EventPayload.kt
//
// All data classes that get serialised to JSON and POSTed to the FastAPI backend.
// Every payload includes device_id and timestamp_ms for the server to process.
// ─────────────────────────────────────────────────────────────────────────────

// Wrapper sent with every request — auth + device identity
data class EventEnvelope<T>(
    @SerializedName("device_id")    val deviceId: String,
    @SerializedName("timestamp_ms") val timestampMs: Long = System.currentTimeMillis(),
    @SerializedName("event_type")   val eventType: String,
    @SerializedName("payload")      val payload: T
)

// ── Event Types ───────────────────────────────────────────────────────────────

enum class EventType {
    UPI_DEBIT,          // Money spent (from notification or SMS)
    NFC_SESSION_START,  // Desk tag tapped to begin focus
    NFC_SESSION_STOP,   // Desk tag tapped to end focus
    USAGE_REPORT,       // App screen-time report (batched, sent every 30 min)
    USAGE_SESSION,      // Real-time single-app session — sent immediately after user leaves app
    STEPS_UPDATE,       // Daily step count snapshot
    HEARTBEAT           // Service alive ping every 15 min (server uses this to
                        // detect if phone went offline mid-session)
}

// ── UPI / Bank Debit ──────────────────────────────────────────────────────────
data class UpiDebitPayload(
    @SerializedName("amount_rupees")  val amountRupees: Int,
    @SerializedName("merchant_name")  val merchantName: String?,   // "Swiggy", "Amazon", null if unknown
    @SerializedName("raw_text")       val rawText: String,         // full notification/SMS text for server AI
    @SerializedName("source")         val source: UpiSource,       // NOTIFICATION | SMS
    @SerializedName("dedup_key")      val dedupKey: String         // hash(amount + truncated_time_window)
)

enum class UpiSource { NOTIFICATION, SMS }

// ── NFC Session ───────────────────────────────────────────────────────────────
data class NfcSessionPayload(
    @SerializedName("tag_id")         val tagId: String,    // unique ID written on the tag
    @SerializedName("tag_label")      val tagLabel: String  // "Desk Tag", "Library Tag" etc.
    // Server generates session_id and tracks start/stop pairing
)

// ── App Usage Report ──────────────────────────────────────────────────────────
// Sent as a batch every 30 minutes — contains all apps used since last report
data class UsageReportPayload(
    @SerializedName("period_start_ms") val periodStartMs: Long,
    @SerializedName("period_end_ms")   val periodEndMs: Long,
    @SerializedName("app_usages")      val appUsages: List<AppUsageEntry>
)

data class AppUsageEntry(
    @SerializedName("package_name")   val packageName: String,    // com.instagram.android
    @SerializedName("app_label")      val appLabel: String,       // Instagram
    @SerializedName("minutes_used")   val minutesUsed: Int
)

// ── Real-time Usage Session ────────────────────────────────────────────────────
// Sent immediately after user leaves a tracked distraction app.
// The AccessibilityService (AppSessionTracker) fires this event in real-time.
data class UsageSessionPayload(
    @SerializedName("package_name")   val packageName: String,
    @SerializedName("app_label")      val appLabel: String,
    @SerializedName("minutes")        val minutes: Float,
    @SerializedName("started_at_ms")  val startedAtMs: Long
)

// ── Step Count ────────────────────────────────────────────────────────────────
data class StepsPayload(
    @SerializedName("steps_today")    val stepsToday: Long,
    @SerializedName("date")           val date: String  // "2025-06-11" (ISO date)
)

// ── Heartbeat ─────────────────────────────────────────────────────────────────
data class HeartbeatPayload(
    @SerializedName("battery_pct")    val batteryPct: Int,
    @SerializedName("is_charging")    val isCharging: Boolean,
    @SerializedName("service_uptime_ms") val serviceUptimeMs: Long
)

// ── Server Response ───────────────────────────────────────────────────────────
// After processing an event, the server sends back any immediate instructions
// (e.g. "you're now bankrupt", "NFC session paid ₹120", "streak lost")
data class ServerAck(
    @SerializedName("status")         val status: String,        // "ok" | "error" | "duplicate"
    @SerializedName("message")        val message: String?,      // human-readable feedback
    @SerializedName("notification")   val notification: PushInstruction?, // show notification on device?
    @SerializedName("active_pass")    val activePass: ActivePassInfo? = null, // active pass info
    @SerializedName("balance")        val balance: Int? = null,
    @SerializedName("streak")         val streak: Int? = null,
    @SerializedName("multiplier")     val multiplier: Double? = null
)

data class ActivePassInfo(
    @SerializedName("pass_id")        val passId: Int,
    @SerializedName("pass_type")      val passType: String,
    @SerializedName("category")       val category: String,
    @SerializedName("expires_at_ms")  val expiresAtMs: Long?,
    @SerializedName("ms_remaining")   val msRemaining: Long?
)

data class PushInstruction(
    @SerializedName("title")    val title: String,
    @SerializedName("body")     val body: String,
    @SerializedName("priority") val priority: String  // "default" | "high" | "bankrupt"
)
