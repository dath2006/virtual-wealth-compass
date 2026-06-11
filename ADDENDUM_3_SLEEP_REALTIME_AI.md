# Backend Spec — Addendum 3: Sleep, Real-time, Achievements, AI Rates

Covers:
- Sleep cycle tracking (manual tap-to-sleep/wake, HealthConnect exercise)
- Real-time distraction drain via AccessibilityService (replaces 24hr audit batch)
- Server-Sent Events (SSE) for live browser dashboard
- Manual deductions with AI-validated explanations
- Achievements system rethink (AI-generated behavioural challenges)
- AI rate advisor (suggests rates, human approves)

---

## Part 1 — Sleep & Exercise Dashboard

### New DB Model: `app/models/wellness.py`

```python
import enum
from sqlalchemy import BigInteger, Integer, Float, String, Boolean, Enum, Date
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time, datetime

class SleepQuality(str, enum.Enum):
    EXCELLENT = "EXCELLENT"   # 8–9 hrs
    GOOD      = "GOOD"        # 7–8 hrs
    ADEQUATE  = "ADEQUATE"    # 6–7 hrs
    POOR      = "POOR"        # 5–6 hrs
    BAD       = "BAD"         # < 5 hrs

class SleepSession(Base):
    __tablename__ = "sleep_sessions"

    id:             Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    sleep_at_ms:    Mapped[int]   = mapped_column(BigInteger, nullable=False)
    wake_at_ms:     Mapped[int]   = mapped_column(BigInteger, nullable=True)
    # wake_at_ms is NULL while session is open (user is asleep)

    duration_hours: Mapped[float] = mapped_column(Float, nullable=True)
    quality:        Mapped[SleepQuality] = mapped_column(Enum(SleepQuality), nullable=True)
    source:         Mapped[str]   = mapped_column(String(20), default="MANUAL")
    # "MANUAL" | "HEALTHCONNECT"

    multiplier_effect: Mapped[float] = mapped_column(Float, nullable=True)
    # The earning multiplier modifier applied to tomorrow based on this sleep.
    # Stored for audit — the actual multiplier is in DailyStats.

    ledger_entry_id: Mapped[int]  = mapped_column(BigInteger, nullable=True)
    # Points to the SLEEP_BONUS or SLEEP_PENALTY ledger entry if any was created.

    date:           Mapped[datetime.date] = mapped_column(Date, nullable=True)
    # The date this sleep is attributed to (the date you WOKE UP)


class ExerciseSession(Base):
    __tablename__ = "exercise_sessions"

    id:             Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exercise_type:  Mapped[str]   = mapped_column(String(50), nullable=False)
    # "RUNNING" | "CYCLING" | "GYM" | "YOGA" | "SPORTS" | "WALK" | "OTHER"

    duration_minutes: Mapped[float] = mapped_column(Float, nullable=False)
    source:           Mapped[str]   = mapped_column(String(20), default="HEALTHCONNECT")
    started_at_ms:    Mapped[int]   = mapped_column(BigInteger, nullable=False)
    earned_amount:    Mapped[int]   = mapped_column(Integer, default=0)
    ledger_entry_id:  Mapped[int]   = mapped_column(BigInteger, nullable=True)
    date:             Mapped[datetime.date] = mapped_column(Date, nullable=True)
```

---

### Sleep Economy Logic: `app/services/sleep_service.py`

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.wellness import SleepSession, SleepQuality
from app.models.stats import DailyStats
from app.services import ledger_service
from app.models.ledger import LedgerCategory
import datetime, time

# Sleep multiplier effect on NEXT DAY's earning rate
# Applied during midnight audit when wake event is processed
SLEEP_MULTIPLIER_MAP = {
    SleepQuality.EXCELLENT: 1.15,   # 8–9 hrs: +15% earning bonus tomorrow
    SleepQuality.GOOD:      1.0,    # 7–8 hrs: normal, no effect
    SleepQuality.ADEQUATE:  0.95,   # 6–7 hrs: -5% debuff
    SleepQuality.POOR:      0.85,   # 5–6 hrs: -15% debuff
    SleepQuality.BAD:       0.75,   # < 5 hrs: -25% severe debuff
}

SLEEP_QUALITY_THRESHOLDS = [
    (9.0, SleepQuality.EXCELLENT),
    (7.0, SleepQuality.GOOD),
    (6.0, SleepQuality.ADEQUATE),
    (5.0, SleepQuality.POOR),
    (0.0, SleepQuality.BAD),
]

def classify_sleep(duration_hours: float) -> SleepQuality:
    for threshold, quality in SLEEP_QUALITY_THRESHOLDS:
        if duration_hours >= threshold:
            return quality
    return SleepQuality.BAD

async def start_sleep(db: AsyncSession, device_id: str) -> SleepSession:
    """Called when user taps 'Going to sleep' on Android or web."""
    # Check if there's already an open sleep session
    result = await db.execute(
        select(SleepSession).where(SleepSession.wake_at_ms.is_(None)).limit(1)
    )
    if result.scalar_one_or_none():
        # Already sleeping — idempotent, return existing
        return result.scalar_one_or_none()

    session = SleepSession(
        sleep_at_ms=int(time.time() * 1000),
        source="MANUAL"
    )
    db.add(session)
    await db.flush()
    return session

async def end_sleep(db: AsyncSession, device_id: str) -> dict:
    """
    Called when user taps 'Good morning' on Android or web.
    Computes sleep duration, quality, and multiplier effect.
    Applies the multiplier to today's DailyStats.
    """
    result = await db.execute(
        select(SleepSession).where(SleepSession.wake_at_ms.is_(None)).limit(1)
    )
    session = result.scalar_one_or_none()
    if not session:
        return {"error": "No open sleep session found"}

    now_ms = int(time.time() * 1000)
    duration_ms    = now_ms - session.sleep_at_ms
    duration_hours = duration_ms / 3_600_000

    quality    = classify_sleep(duration_hours)
    multiplier = SLEEP_MULTIPLIER_MAP[quality]
    wake_date  = datetime.date.today()

    session.wake_at_ms        = now_ms
    session.duration_hours    = round(duration_hours, 2)
    session.quality           = quality
    session.multiplier_effect = multiplier
    session.date              = wake_date

    # Apply multiplier to today's DailyStats
    # It STACKS with the streak multiplier (multiplicative, not additive)
    # e.g. streak 1.5× × sleep 0.85× = 1.275× effective
    from app.services.economy_service import get_or_create_daily_stats
    stats = await get_or_create_daily_stats(db)
    stats.sleep_multiplier = multiplier  # add this column to DailyStats

    # Insert a descriptive ledger entry for transparency (₹0 amount — it's a modifier)
    desc_map = {
        SleepQuality.EXCELLENT: f"Sleep bonus: {duration_hours:.1f}h — +15% earn rate today",
        SleepQuality.GOOD:      f"Sleep: {duration_hours:.1f}h — normal earn rate",
        SleepQuality.ADEQUATE:  f"Sleep debuff: {duration_hours:.1f}h — -5% earn rate today",
        SleepQuality.POOR:      f"Sleep debuff: {duration_hours:.1f}h — -15% earn rate today",
        SleepQuality.BAD:       f"Sleep debuff: {duration_hours:.1f}h — -25% earn rate today",
    }
    entry = await ledger_service.insert_entry(
        db=db,
        amount=0,   # no monetary value — it's a rate modifier
        category=LedgerCategory.SLEEP_EVENT,   # add to LedgerCategory enum
        description=desc_map[quality],
    )
    session.ledger_entry_id = entry.id

    return {
        "duration_hours": round(duration_hours, 2),
        "quality":        quality.value,
        "multiplier":     multiplier,
        "message":        desc_map[quality],
    }


async def get_exercise_earn_rate(exercise_type: str, settings) -> int:
    """
    Exercise earn rate per 10 minutes.
    Higher intensity = higher rate.
    Differentiated from steps (which is low-intensity passive walking).
    """
    rates = {
        "RUNNING":  settings.hourly_earn_rate // 3,    # ₹33/10min at ₹100/hr base
        "CYCLING":  settings.hourly_earn_rate // 4,    # ₹25/10min
        "GYM":      settings.hourly_earn_rate // 3,    # ₹33/10min
        "YOGA":     settings.hourly_earn_rate // 5,    # ₹20/10min
        "SPORTS":   settings.hourly_earn_rate // 3,    # ₹33/10min
        "WALK":     settings.hourly_earn_rate // 8,    # ₹12/10min (above step income)
        "OTHER":    settings.hourly_earn_rate // 6,    # ₹16/10min
    }
    return rates.get(exercise_type, rates["OTHER"])
```

---

### New Router: `app/routers/wellness.py`

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.wellness import SleepSession, ExerciseSession
from app.services.sleep_service import start_sleep, end_sleep, get_exercise_earn_rate
from app.services import ledger_service
from app.models.ledger import LedgerCategory
import datetime, time

router = APIRouter(prefix="/wellness", dependencies=[Depends(verify_api_key)])

# ── Sleep endpoints ───────────────────────────────────────────────────────────

@router.post("/sleep/start")
async def sleep_start(db: AsyncSession = Depends(get_db)):
    """User taps 'Going to sleep'. Works from web or Android."""
    session = await start_sleep(db, device_id="web")
    await db.commit()
    return {"session_id": session.id, "sleep_at_ms": session.sleep_at_ms}

@router.post("/sleep/wake")
async def sleep_wake(db: AsyncSession = Depends(get_db)):
    """User taps 'Good morning'. Computes sleep quality and applies multiplier."""
    result = await end_sleep(db, device_id="web")
    await db.commit()
    return result

@router.get("/sleep/history")
async def sleep_history(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SleepSession)
        .where(SleepSession.wake_at_ms.isnot(None))
        .order_by(SleepSession.sleep_at_ms.desc())
        .limit(30)
    )
    sessions = result.scalars().all()
    return [
        {
            "id":             s.id,
            "sleep_at_ms":   s.sleep_at_ms,
            "wake_at_ms":    s.wake_at_ms,
            "duration_hours": s.duration_hours,
            "quality":        s.quality.value if s.quality else None,
            "multiplier":     s.multiplier_effect,
            "date":           str(s.date),
        }
        for s in sessions
    ]

@router.get("/sleep/current")
async def sleep_current(db: AsyncSession = Depends(get_db)):
    """Returns open sleep session if sleeping, null if awake."""
    result = await db.execute(
        select(SleepSession).where(SleepSession.wake_at_ms.is_(None)).limit(1)
    )
    session = result.scalar_one_or_none()
    if not session:
        return {"is_sleeping": False}
    return {
        "is_sleeping": True,
        "sleep_at_ms": session.sleep_at_ms,
        "elapsed_hours": (time.time() * 1000 - session.sleep_at_ms) / 3_600_000
    }

# ── Exercise endpoint ─────────────────────────────────────────────────────────

class ExerciseLogRequest(BaseModel):
    exercise_type:    str
    duration_minutes: float
    started_at_ms:    int | None = None

@router.post("/exercise/log")
async def log_exercise(req: ExerciseLogRequest, db: AsyncSession = Depends(get_db)):
    """
    Called from Android (HealthConnect sync) or web (manual log).
    Awards exercise income based on type and duration.
    """
    settings    = await __import__('app.services.economy_service',
                    fromlist=['get_settings']).get_settings(db)
    rate_per_10 = await get_exercise_earn_rate(req.exercise_type, settings)
    earned      = int((req.duration_minutes / 10) * rate_per_10)

    entry = await ledger_service.insert_entry(
        db=db,
        amount=earned,
        category=LedgerCategory.STEP_INCOME,   # reuse or add EXERCISE_INCOME
        description=f"{req.exercise_type.title()}: {int(req.duration_minutes)}min → ₹{earned}",
    )

    exercise = ExerciseSession(
        exercise_type=req.exercise_type,
        duration_minutes=req.duration_minutes,
        started_at_ms=req.started_at_ms or int(time.time() * 1000),
        earned_amount=earned,
        ledger_entry_id=entry.id,
        date=datetime.date.today(),
    )
    db.add(exercise)
    await db.commit()

    return {
        "earned": earned,
        "exercise_type": req.exercise_type,
        "duration_minutes": req.duration_minutes,
        "rate_per_10_min": rate_per_10,
    }

@router.get("/dashboard")
async def wellness_dashboard(db: AsyncSession = Depends(get_db)):
    """
    Returns everything the Wellness Dashboard page needs in one call:
    sleep history (30 days), exercise history (30 days), step history (30 days).
    """
    from app.models.stats import DailyStats
    from sqlalchemy import func

    thirty_days_ago = datetime.date.today() - datetime.timedelta(days=30)

    sleep_result = await db.execute(
        select(SleepSession)
        .where(SleepSession.date >= thirty_days_ago)
        .order_by(SleepSession.date.desc())
    )
    exercise_result = await db.execute(
        select(ExerciseSession)
        .where(ExerciseSession.date >= thirty_days_ago)
        .order_by(ExerciseSession.date.desc())
    )
    stats_result = await db.execute(
        select(DailyStats)
        .where(DailyStats.date >= thirty_days_ago)
        .order_by(DailyStats.date.desc())
    )

    sleep_sessions  = sleep_result.scalars().all()
    exercise_sessions = exercise_result.scalars().all()
    daily_stats     = stats_result.scalars().all()

    # Current sleep state
    current_sleep_result = await db.execute(
        select(SleepSession).where(SleepSession.wake_at_ms.is_(None)).limit(1)
    )
    current_sleep = current_sleep_result.scalar_one_or_none()

    return {
        "current_sleep": {
            "is_sleeping": current_sleep is not None,
            "sleep_at_ms": current_sleep.sleep_at_ms if current_sleep else None,
        },
        "sleep_history": [
            {
                "date": str(s.date),
                "duration_hours": s.duration_hours,
                "quality": s.quality.value if s.quality else None,
                "multiplier": s.multiplier_effect,
            }
            for s in sleep_sessions
        ],
        "exercise_history": [
            {
                "date": str(e.date),
                "exercise_type": e.exercise_type,
                "duration_minutes": e.duration_minutes,
                "earned": e.earned_amount,
            }
            for e in exercise_sessions
        ],
        "step_history": [
            {
                "date": str(d.date),
                "steps": getattr(d, 'steps_today', 0),
                "step_income": getattr(d, 'step_income_amount', 0),
            }
            for d in daily_stats
        ],
        "sleep_multiplier_today": getattr(
            next((d for d in daily_stats if d.date == datetime.date.today()), None),
            'sleep_multiplier', 1.0
        ),
    }
```

---

## Part 2 — Real-time Drain via AccessibilityService

### How it works end-to-end

```
User opens Instagram (Nothing Phone 2)
  ↓
AccessibilityService fires TYPE_WINDOW_STATE_CHANGED
  ↓ records: {pkg: instagram, opened_at: now_ms}

User closes Instagram / switches app (8 minutes later)
  ↓
AccessibilityService fires again
  ↓ computes session: 8 minutes
  ↓ POST /events/usage_session {package_name, app_label, minutes: 8, started_at_ms}
  ↓
Server bills immediately:
  - looks up DistractionRule for instagram
  - checks active pass (skip if covered)
  - inserts ledger entry: -₹16 (8min × ₹2/min)
  - pushes SSE event to browser: {type: "drain", amount: -16, app: "Instagram"}
  ↓
Browser dashboard updates balance live: ₹1,240 → ₹1,224
```

### Android: New file `AppSessionTracker.kt`

```kotlin
package com.productivityapp

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

// ─────────────────────────────────────────────────────────────────────────────
// AppSessionTracker.kt
//
// Tracks foreground app sessions in real time using AccessibilityService.
// Fires a POST to VPS as soon as the user leaves a distraction app.
//
// This REPLACES the 30-min UsageTracker batch for distraction drain.
// UsageTracker can still run for the daily summary, but drain billing
// now happens per-session in near real-time.
//
// Setup: declare in AndroidManifest.xml and create res/xml/accessibility_config.xml
// User must enable in: Settings → Accessibility → Installed Services →
//                      Productivity Economy Session Tracker
// ─────────────────────────────────────────────────────────────────────────────
class AppSessionTracker : AccessibilityService() {

    private val scope = CoroutineScope(Dispatchers.IO)

    // Track the currently foregrounded app
    private var currentPackage: String = ""
    private var sessionStartMs: Long   = 0L

    // Minimum session to bill: 1 minute (prevents noise from brief app switches)
    private val MIN_BILLABLE_MINUTES = 1

    companion object {
        // Apps to NEVER bill (system UI, launchers, our own app)
        val IGNORED_PACKAGES = setOf(
            "android",
            "com.android.systemui",
            "com.nothing.launcher",
            "com.android.launcher3",
            "com.productivityapp",
            "com.android.settings",
            "com.google.android.inputmethod.latin",
        )
    }

    override fun onServiceConnected() {
        serviceInfo = AccessibilityServiceInfo().apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
            // Only fire on window changes — not on every scroll/click
            // This is the lowest-battery-impact configuration
            notificationTimeout = 200  // ms debounce
        }
        Log.i("AppSessionTracker", "Accessibility service connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val newPackage = event.packageName?.toString() ?: return
        if (newPackage == currentPackage) return        // same app, no change
        if (newPackage in IGNORED_PACKAGES) return      // system UI, skip

        val now = System.currentTimeMillis()

        // ── End previous session ─────────────────────────────────────────
        if (currentPackage.isNotEmpty() && sessionStartMs > 0) {
            val elapsedMs      = now - sessionStartMs
            val elapsedMinutes = elapsedMs / 60_000.0

            if (elapsedMinutes >= MIN_BILLABLE_MINUTES) {
                sendUsageSession(
                    packageName  = currentPackage,
                    minutes      = elapsedMinutes,
                    startedAtMs  = sessionStartMs,
                )
            }
        }

        // ── Start new session ────────────────────────────────────────────
        currentPackage = newPackage
        sessionStartMs = now
    }

    private fun sendUsageSession(packageName: String, minutes: Double, startedAtMs: Long) {
        scope.launch {
            try {
                val appLabel = getAppLabel(packageName)
                val envelope = EventEnvelope(
                    deviceId  = BuildConfig.DEVICE_ID,
                    eventType = "USAGE_SESSION",   // new event type
                    payload   = mapOf(
                        "package_name"   to packageName,
                        "app_label"      to appLabel,
                        "minutes"        to minutes,
                        "started_at_ms"  to startedAtMs,
                    )
                )

                // Add USAGE_SESSION to the Retrofit interface
                val response = ApiClient.get().sendUsageSession(envelope)

                // Server response may include a drain notification
                response.body()?.notification?.let { push ->
                    if (push.priority == "high" || push.priority == "bankrupt") {
                        NotificationHelper.showFromServer(
                            applicationContext, push
                        )
                    }
                    // Update persistent notification with new balance
                    push.body?.let { MainForegroundService.updateBalanceNotif(it) }
                }

            } catch (e: Exception) {
                Log.e("AppSessionTracker", "Failed to send session: ${e.message}")
                // Queue for retry
                OfflineQueue(applicationContext).enqueue("USAGE_SESSION", mapOf(
                    "package_name"  to packageName,
                    "minutes"       to minutes,
                    "started_at_ms" to startedAtMs,
                ))
            }
        }
    }

    private fun getAppLabel(packageName: String): String {
        return try {
            val pm   = packageManager
            val info = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(info).toString()
        } catch (e: Exception) { packageName }
    }

    override fun onInterrupt() {
        Log.w("AppSessionTracker", "Accessibility service interrupted")
    }
}
```

### `res/xml/accessibility_config.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<accessibility-service
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagReportViewIds"
    android:canRetrieveWindowContent="false"
    android:description="@string/accessibility_description"
    android:notificationTimeout="200"
    android:settingsActivity="com.productivityapp.PermissionSetupActivity" />
```

Note `canRetrieveWindowContent="false"` — this explicitly tells Android the service
does not read screen content, only window-change events. This is honest, reduces the
permission footprint, and survives scrutiny if you ever publish to Play Store.

### AndroidManifest.xml addition

```xml
<service
    android:name=".AppSessionTracker"
    android:exported="true"
    android:label="Session Tracker"
    android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
    <intent-filter>
        <action android:name="android.accessibilityservice.AccessibilityService" />
    </intent-filter>
    <meta-data
        android:name="android.accessibilityservice"
        android:resource="@xml/accessibility_config" />
</service>
```

### Add to `ApiClient.kt` Retrofit interface

```kotlin
@POST("events/usage_session")
suspend fun sendUsageSession(
    @Body body: EventEnvelope<Map<String, Any>>
): Response<ServerAck>
```

### New backend event handler: `POST /events/usage_session`

Add to `app/routers/events.py`:

```python
class UsageSessionPayload(BaseModel):
    package_name:  str
    app_label:     str
    minutes:       float
    started_at_ms: int

@router.post("/usage_session")
async def receive_usage_session(
    envelope: EventEnvelope,
    db: AsyncSession = Depends(get_db)
):
    """
    Real-time per-session drain billing.
    Called immediately after user leaves a distraction app.
    Replaces the midnight batch drain for real-time billing.
    """
    payload = UsageSessionPayload(**envelope.payload)

    # Check for active marketplace pass covering this app
    from app.routers.marketplace import get_active_pass_for_heartbeat
    active_pass = await get_active_pass_for_heartbeat(db)
    if active_pass and _pass_covers_package(active_pass["pass_type"], payload.package_name):
        # Pass is active — zero drain, still acknowledge
        return {"status": "ok", "drained": 0, "covered_by_pass": True}

    # Look up distraction rule for this package
    from app.models.rules import DistractionRule
    rule_result = await db.execute(
        select(DistractionRule).where(
            DistractionRule.package_name == payload.package_name
        )
    )
    rule = rule_result.scalar_one_or_none()
    if not rule:
        # Not a tracked distraction app — ignore
        return {"status": "ok", "drained": 0, "tracked": False}

    # Determine surge pricing
    settings     = await economy_service.get_settings(db)
    current_hour = datetime.datetime.now().hour
    is_surge     = (
        rule.is_surge_enabled and
        settings.study_hours_start <= current_hour < settings.study_hours_end
    )
    cost_per_min = rule.surge_cost_per_minute if is_surge else rule.cost_per_minute
    penalty      = int(payload.minutes * cost_per_min)

    if penalty == 0:
        return {"status": "ok", "drained": 0}

    await ledger_service.insert_entry(
        db=db,
        amount=-penalty,
        category=LedgerCategory.DISTRACTION,
        description=f"{int(payload.minutes)}min on {rule.app_label} "
                    f"(₹{cost_per_min}/min{'⚡ surge' if is_surge else ''})",
        merchant_name=rule.app_label,
    )

    balance = await ledger_service.get_balance(db)

    # Push SSE event to browser dashboard (see Part 3)
    await sse_manager.push({
        "type":    "drain",
        "app":     rule.app_label,
        "amount":  -penalty,
        "balance": balance,
        "surge":   is_surge,
    })

    notification = None
    if balance < 0:
        notification = {
            "title": "⚠ Bankrupt!",
            "body":  f"Went negative after {int(payload.minutes)}min on {rule.app_label}",
            "priority": "bankrupt"
        }
    elif is_surge:
        notification = {
            "title": f"⚡ Surge: ₹{penalty} drained",
            "body":  f"{int(payload.minutes)}min on {rule.app_label} during study hours "
                     f"(₹{cost_per_min}/min). Balance: ₹{balance}",
            "priority": "high"
        }

    return {
        "status":   "ok",
        "drained":  penalty,
        "balance":  balance,
        "surge":    is_surge,
        "notification": notification
    }

def _pass_covers_package(pass_type: str, package_name: str) -> bool:
    from app.routers.marketplace import isPassCoveringApp_server
    # Mirrors the Android isPassCoveringApp logic server-side
    coverage = {
        "MOVIE":   {"com.netflix.mediaclient", "com.google.android.youtube",
                    "com.amazon.avod.thirdpartyclient", "com.hotstar.android"},
        "GAMING":  set(),   # server doesn't know user's game list — Android handles this
        "BINGE":   {"com.netflix.mediaclient", "com.google.android.youtube",
                    "com.amazon.avod.thirdpartyclient"},
        "NAP":     None,    # None = covers all
        "VACATION_MODE": None,
        "WEEKEND_MODE":  None,
    }
    apps = coverage.get(pass_type)
    if apps is None:
        return True   # covers all
    return package_name in apps
```

---

## Part 3 — Server-Sent Events (SSE) for Live Browser Dashboard

SSE is one-way push from server to browser. The browser opens one persistent HTTP
connection to `/stream`, and the server pushes JSON events down it whenever the
economy state changes. No polling. No WebSockets. Works through Nginx proxies.

### `app/services/sse_manager.py`

```python
import asyncio
import json
from typing import AsyncGenerator

class SSEManager:
    """
    In-process SSE broadcaster.
    For multi-process deployments, replace with Redis pub/sub.
    Single-process (one uvicorn worker) is fine for personal use.
    """
    def __init__(self):
        self._listeners: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=50)
        self._listeners.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        try:
            self._listeners.remove(q)
        except ValueError:
            pass

    async def push(self, event: dict):
        """Push an event to all connected browser clients."""
        data = json.dumps(event)
        dead = []
        for q in self._listeners:
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                dead.append(q)   # client too slow — disconnect them
        for q in dead:
            self.unsubscribe(q)

    async def stream(self, q: asyncio.Queue) -> AsyncGenerator[str, None]:
        """AsyncGenerator that yields SSE-formatted strings."""
        try:
            while True:
                data = await asyncio.wait_for(q.get(), timeout=30.0)
                yield f"data: {data}\n\n"
        except asyncio.TimeoutError:
            # Send keepalive ping every 30s to prevent proxy timeouts
            yield ": keepalive\n\n"
        except asyncio.CancelledError:
            return

# Singleton — imported by routers that need to push events
sse_manager = SSEManager()
```

### SSE Router: `app/routers/stream.py`

```python
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from app.services.sse_manager import sse_manager
from app.middleware.auth import verify_api_key

router = APIRouter(dependencies=[Depends(verify_api_key)])

@router.get("/stream")
async def event_stream(request: Request):
    """
    Browser connects here once and receives live economy events.
    Events pushed by: /events/usage_session, /events/upi, /events/nfc, heartbeat.

    Event types the browser receives:
    - {"type": "drain",   "app": "Instagram", "amount": -16, "balance": 1224}
    - {"type": "earn",    "source": "NFC",    "amount": 200,  "balance": 1424}
    - {"type": "upi",     "merchant": "Swiggy","amount": -180, "balance": 1244}
    - {"type": "balance", "balance": 1244}   (general refresh)
    - {"type": "pass_expired", "pass_type": "MOVIE"}
    - {"type": "boss_beaten",  "title": "DBMS End Sem", "loot": 500}
    """
    q = sse_manager.subscribe()

    async def generator():
        try:
            # Send current balance immediately on connect
            from app.database import AsyncSessionLocal
            from app.services.ledger_service import get_balance
            async with AsyncSessionLocal() as db:
                balance = await get_balance(db)
            yield f"data: {json.dumps({'type': 'init', 'balance': balance})}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                async for chunk in sse_manager.stream(q):
                    yield chunk
        finally:
            sse_manager.unsubscribe(q)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",   # tell Nginx not to buffer SSE
        }
    )
```

### Wire up in `app/main.py`

```python
from app.routers import stream
app.include_router(stream.router)
```

### Push SSE from all event handlers

Add `await sse_manager.push({...})` at the end of each event handler that changes balance:

```python
# In /events/nfc (session stopped):
await sse_manager.push({"type": "earn", "source": "NFC",
                        "amount": final, "balance": balance})

# In /events/upi:
await sse_manager.push({"type": "upi", "merchant": payload.merchant_name,
                        "amount": -virtual_cost, "balance": balance})

# In /events/steps:
await sse_manager.push({"type": "earn", "source": "STEPS",
                        "amount": earned, "balance": balance})
```

### Frontend: SSE hook `src/lib/hooks/useEconomyStream.ts`

```typescript
import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

// Stream event shape from server
interface StreamEvent {
  type: 'init' | 'drain' | 'earn' | 'upi' | 'balance'
       | 'pass_expired' | 'boss_beaten'
  balance?: number
  amount?: number
  app?: string
  source?: string
  merchant?: string
  pass_type?: string
  title?: string
  loot?: number
  surge?: boolean
}

export function useEconomyStream(onEvent?: (e: StreamEvent) => void) {
  const queryClient = useQueryClient()
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (import.meta.env.VITE_USE_MOCK_DATA === 'true') return
    // Don't connect SSE in mock mode

    const es = new EventSource(
      `${import.meta.env.VITE_API_BASE_URL}/stream`,
      // EventSource doesn't support custom headers natively
      // Use query param auth for SSE: /stream?key=...
      // OR use a polyfill that supports headers (fetchEventSource from @microsoft/fetch-event-source)
    )

    es.onmessage = (event) => {
      const data: StreamEvent = JSON.parse(event.data)

      // Invalidate React Query caches so components re-fetch
      if (data.balance !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        queryClient.invalidateQueries({ queryKey: ['ledger'] })
      }
      if (data.type === 'pass_expired') {
        queryClient.invalidateQueries({ queryKey: ['my-passes'] })
      }
      if (data.type === 'boss_beaten') {
        queryClient.invalidateQueries({ queryKey: ['bosses'] })
      }

      onEvent?.(data)
    }

    es.onerror = () => {
      // Auto-reconnect is built into EventSource — no manual retry needed
      console.warn('SSE connection lost, browser will retry automatically')
    }

    esRef.current = es
    return () => es.close()
  }, [])
}
```

**Note on SSE auth:** Browser `EventSource` doesn't support custom headers.
Two options:
1. Short-lived token: `GET /stream-token` returns a 60-second JWT, use as
   `?token=...` query param on the SSE URL
2. Use `@microsoft/fetch-event-source` npm package — a drop-in EventSource
   replacement that supports headers

Option 2 is cleaner. Install: `npm install @microsoft/fetch-event-source`

---

## Part 4 — Manual Deductions with AI Validation

### New DB Model: `app/models/deduction.py`

```python
import enum
from sqlalchemy import BigInteger, Integer, String, Boolean, Enum, Float
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time

class DeductionStatus(str, enum.Enum):
    PENDING_AI  = "PENDING_AI"   # submitted, waiting for AI verdict
    APPROVED    = "APPROVED"     # AI approved it
    REJECTED    = "REJECTED"     # AI rejected it
    OVERRIDDEN  = "OVERRIDDEN"   # AI rejected but user overrode (with extra tax)

class ManualDeduction(Base):
    __tablename__ = "manual_deductions"

    id:              Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    amount:          Mapped[int]   = mapped_column(Integer, nullable=False)
    reason:          Mapped[str]   = mapped_column(String(500), nullable=False)
    # User explains WHY they deserve this penalty
    # e.g. "I wasted 2 hours procrastinating instead of studying DBMS"

    category:        Mapped[str]   = mapped_column(String(50), default="SELF_PENALTY")
    # "SELF_PENALTY" | "HABIT_BREACH" | "RULE_VIOLATION" | "CUSTOM"

    ai_verdict:      Mapped[str]   = mapped_column(String(50), nullable=True)
    # "APPROVED" | "REJECTED" | "REDUCED"

    ai_reasoning:    Mapped[str]   = mapped_column(String(500), nullable=True)
    ai_suggested_amount: Mapped[int] = mapped_column(Integer, nullable=True)
    # AI may suggest a lower amount if the self-penalty seems excessive

    status:          Mapped[DeductionStatus] = mapped_column(
                         Enum(DeductionStatus), default=DeductionStatus.PENDING_AI)

    ledger_entry_id: Mapped[int]   = mapped_column(BigInteger, nullable=True)
    submitted_at_ms: Mapped[int]   = mapped_column(BigInteger,
                         default=lambda: int(time.time() * 1000))
    resolved_at_ms:  Mapped[int]   = mapped_column(BigInteger, nullable=True)
    override_tax_paid: Mapped[int] = mapped_column(Integer, default=0)
    # If AI rejects but user overrides, they pay an extra 20% "stubbornness tax"
```

### Service: `app/services/deduction_service.py`

```python
import json
from app.services.ai_service import _call_gemini_text
from app.services import ledger_service
from app.models.ledger import LedgerCategory

OVERRIDE_TAX_PCT = 0.20   # 20% extra if overriding AI rejection

async def validate_deduction_with_ai(
    amount: int,
    reason: str,
    hourly_earn_rate: int,
) -> dict:
    """
    AI validates whether a manual self-penalty is reasonable and proportional.
    It should reject:
      - Vague reasons ("I was bad today")
      - Disproportionately large amounts for minor infractions
      - Reasons that don't match the category (e.g. claiming financial penalty for a physical habit)
    It may suggest a reduced amount.
    """
    prompt = f"""You are a fair personal accountability coach reviewing a self-imposed penalty.

The user wants to deduct ₹{amount} from their virtual wallet as a self-penalty.
Their hourly study earn rate is ₹{hourly_earn_rate}/hr.
Their reason: "{reason}"

Evaluate this penalty:
1. Is the reason specific and genuine? (reject vague reasons like "I was bad")
2. Is the amount proportional to the infraction relative to their earn rate?
   (e.g. ₹{hourly_earn_rate * 2} for wasting an entire study day is reasonable;
    ₹{hourly_earn_rate * 10} for checking Instagram once is not)
3. If the amount seems excessive, suggest a more proportional amount.

Respond ONLY with valid JSON, no markdown:
{{
  "verdict": "APPROVED" or "REJECTED" or "REDUCED",
  "approved_amount": integer (same as requested if APPROVED, 0 if REJECTED, reduced if REDUCED),
  "reasoning": "one or two sentence explanation"
}}"""

    response = await _call_gemini_text(prompt, max_tokens=150)
    try:
        return json.loads(response)
    except Exception:
        return {"verdict": "APPROVED", "approved_amount": amount,
                "reasoning": "AI unavailable — penalty approved as submitted"}
```

### Router: `app/routers/deductions.py`

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.deduction import ManualDeduction, DeductionStatus
from app.services import ledger_service, economy_service
from app.services.deduction_service import validate_deduction_with_ai, OVERRIDE_TAX_PCT
from app.models.ledger import LedgerCategory
import time

router = APIRouter(prefix="/deductions", dependencies=[Depends(verify_api_key)])

class DeductionRequest(BaseModel):
    amount:   int
    reason:   str
    category: str = "SELF_PENALTY"

class OverrideRequest(BaseModel):
    deduction_id: int

@router.post("", status_code=201)
async def submit_deduction(req: DeductionRequest, db: AsyncSession = Depends(get_db)):
    """
    Submit a manual self-penalty. AI validates and responds immediately.
    If APPROVED or REDUCED: ledger entry created right away.
    If REJECTED: user can override (with stubbornness tax) or cancel.
    """
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if len(req.reason.strip()) < 20:
        raise HTTPException(
            status_code=400,
            detail="Reason must be at least 20 characters. Be specific."
        )

    settings = await economy_service.get_settings(db)
    verdict  = await validate_deduction_with_ai(
        amount=req.amount,
        reason=req.reason,
        hourly_earn_rate=settings.hourly_earn_rate
    )

    deduction = ManualDeduction(
        amount=req.amount,
        reason=req.reason,
        category=req.category,
        ai_verdict=verdict["verdict"],
        ai_reasoning=verdict["reasoning"],
        ai_suggested_amount=verdict.get("approved_amount", req.amount),
    )
    db.add(deduction)

    if verdict["verdict"] in ("APPROVED", "REDUCED"):
        actual_amount = verdict["approved_amount"]
        entry = await ledger_service.insert_entry(
            db=db,
            amount=-actual_amount,
            category=LedgerCategory.LAZY_TAX,   # or add MANUAL_DEDUCTION category
            description=f"Self-penalty: {req.reason[:100]}",
        )
        deduction.status         = DeductionStatus.APPROVED
        deduction.ledger_entry_id = entry.id
        deduction.resolved_at_ms = int(time.time() * 1000)

        await db.commit()
        balance = await ledger_service.get_balance(db)
        return {
            "verdict":        verdict["verdict"],
            "amount_deducted": actual_amount,
            "original_amount": req.amount,
            "reasoning":      verdict["reasoning"],
            "new_balance":    balance,
            "deduction_id":   deduction.id,
        }
    else:
        # REJECTED — user can override
        deduction.status = DeductionStatus.PENDING_AI
        await db.commit()
        override_tax = int(req.amount * OVERRIDE_TAX_PCT)
        return {
            "verdict":      "REJECTED",
            "reasoning":    verdict["reasoning"],
            "deduction_id": deduction.id,
            "can_override": True,
            "override_cost": req.amount + override_tax,
            "override_tax":  override_tax,
            "message":      "AI rejected this penalty. You can override with a 20% stubbornness tax."
        }

@router.post("/override")
async def override_rejection(req: OverrideRequest, db: AsyncSession = Depends(get_db)):
    """User insists on applying a rejected penalty — pays 20% extra."""
    result    = await db.execute(
        select(ManualDeduction).where(ManualDeduction.id == req.deduction_id)
    )
    deduction = result.scalar_one_or_none()
    if not deduction:
        raise HTTPException(status_code=404, detail="Deduction not found")
    if deduction.status != DeductionStatus.PENDING_AI:
        raise HTTPException(status_code=400, detail="Can only override PENDING deductions")

    override_tax   = int(deduction.amount * OVERRIDE_TAX_PCT)
    total_deducted = deduction.amount + override_tax

    entry = await ledger_service.insert_entry(
        db=db,
        amount=-total_deducted,
        category=LedgerCategory.LAZY_TAX,
        description=f"Self-penalty (override +{int(OVERRIDE_TAX_PCT*100)}% tax): "
                    f"{deduction.reason[:80]}",
    )
    deduction.status            = DeductionStatus.OVERRIDDEN
    deduction.ledger_entry_id   = entry.id
    deduction.override_tax_paid = override_tax
    deduction.resolved_at_ms    = int(time.time() * 1000)

    await db.commit()
    balance = await ledger_service.get_balance(db)
    return {
        "amount_deducted": total_deducted,
        "stubbornness_tax": override_tax,
        "new_balance":     balance,
    }
```

---

## Part 5 — Achievements Rethink: AI-Generated Behavioural Challenges

### Core Concept

Instead of a static badge shelf, achievements are **dynamic weekly challenges**
generated by AI based on the user's actual behaviour patterns. The AI looks at the
last 14 days of data and generates 3 personalised challenges.

```
AI observes:
  - Instagram drain: ₹340/week (your highest category)
  - Study sessions: avg 1.4hr/day (target is 3hr)
  - No exercise logged in 9 days
  - Streak broken twice this month

AI generates challenges:
  1. "Instagram Detox Week" — keep Instagram drain under ₹100 this week → reward ₹400
  2. "Hit Your Target" — complete 3hr study for 4 consecutive days → reward 1 Mercy Token
  3. "Break a Sweat" — log any exercise 3 times this week → reward ₹200
```

### DB Model: `app/models/achievement.py`

```python
import enum
from sqlalchemy import BigInteger, Integer, String, Boolean, Enum, Date
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import datetime

class ChallengeStatus(str, enum.Enum):
    ACTIVE    = "ACTIVE"
    COMPLETED = "COMPLETED"
    FAILED    = "FAILED"
    EXPIRED   = "EXPIRED"

class RewardType(str, enum.Enum):
    RUPEE_PAYOUT = "RUPEE_PAYOUT"
    MERCY_TOKEN  = "MERCY_TOKEN"
    MULTIPLIER_BOOST = "MULTIPLIER_BOOST"   # +0.2× for 3 days

class AIChallenge(Base):
    __tablename__ = "ai_challenges"

    id:              Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title:           Mapped[str]   = mapped_column(String(200), nullable=False)
    description:     Mapped[str]   = mapped_column(String(500), nullable=False)
    metric_type:     Mapped[str]   = mapped_column(String(50), nullable=False)
    # "DISTRACTION_DRAIN_MAX" | "STUDY_HOURS_MIN" | "EXERCISE_COUNT"
    # | "STREAK_DAYS" | "STEP_COUNT_MIN" | "SLEEP_QUALITY_MIN"

    metric_target:   Mapped[float] = mapped_column(Integer, nullable=False)
    # e.g. for DISTRACTION_DRAIN_MAX: 100 (means drain must stay under ₹100)

    metric_package:  Mapped[str]   = mapped_column(String(200), nullable=True)
    # For app-specific challenges: "com.instagram.android"

    current_value:   Mapped[float] = mapped_column(Integer, default=0)
    status:          Mapped[ChallengeStatus] = mapped_column(
                         Enum(ChallengeStatus), default=ChallengeStatus.ACTIVE)

    reward_type:     Mapped[RewardType] = mapped_column(Enum(RewardType))
    reward_value:    Mapped[int]  = mapped_column(Integer, nullable=False)

    generated_at:    Mapped[datetime.date] = mapped_column(Date, nullable=False)
    expires_at:      Mapped[datetime.date] = mapped_column(Date, nullable=False)
    completed_at:    Mapped[datetime.date] = mapped_column(Date, nullable=True)

    ai_rationale:    Mapped[str]  = mapped_column(String(300), nullable=True)
    # Why the AI chose this challenge — shown to user for transparency
```

### Service: `app/services/achievement_service.py`

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models.achievement import AIChallenge, ChallengeStatus, RewardType
from app.models.ledger import LedgerEntry, LedgerCategory
from app.models.stats import DailyStats
from app.services.ai_service import _call_gemini_text
from app.services import ledger_service
import json, datetime

async def generate_weekly_challenges(db: AsyncSession) -> list[AIChallenge]:
    """
    Called every Monday by APScheduler.
    Analyses last 14 days of behaviour and generates 3 personalised challenges.
    """
    summary = await _build_behaviour_summary(db)
    challenges_json = await _ask_ai_for_challenges(summary)
    challenges = []

    for c in challenges_json[:3]:   # max 3 challenges
        challenge = AIChallenge(
            title=c["title"],
            description=c["description"],
            metric_type=c["metric_type"],
            metric_target=c["metric_target"],
            metric_package=c.get("metric_package"),
            reward_type=RewardType(c["reward_type"]),
            reward_value=c["reward_value"],
            generated_at=datetime.date.today(),
            expires_at=datetime.date.today() + datetime.timedelta(days=7),
            ai_rationale=c.get("rationale", ""),
        )
        db.add(challenge)
        challenges.append(challenge)

    await db.flush()
    return challenges

async def _build_behaviour_summary(db: AsyncSession) -> dict:
    """Aggregates last 14 days of data for the AI prompt context."""
    fourteen_days_ago_ms = int(
        (datetime.datetime.now() - datetime.timedelta(days=14)).timestamp() * 1000
    )

    # Top distraction apps by drain
    drain_result = await db.execute(
        select(
            LedgerEntry.merchant_name,
            func.sum(func.abs(LedgerEntry.amount)).label("total_drain")
        )
        .where(and_(
            LedgerEntry.category == LedgerCategory.DISTRACTION,
            LedgerEntry.timestamp_ms >= fourteen_days_ago_ms,
            LedgerEntry.merchant_name.isnot(None)
        ))
        .group_by(LedgerEntry.merchant_name)
        .order_by(func.sum(func.abs(LedgerEntry.amount)).desc())
        .limit(5)
    )
    top_drains = [{"app": r[0], "total": r[1]} for r in drain_result.all()]

    # Study hours average
    stats_result = await db.execute(
        select(DailyStats)
        .where(DailyStats.date >= (datetime.date.today() - datetime.timedelta(days=14)))
    )
    stats = stats_result.scalars().all()
    avg_study_hours = sum(s.minutes_worked for s in stats) / (14 * 60) if stats else 0
    streak_breaks   = sum(1 for s in stats if not s.target_hit)

    return {
        "top_distraction_drains": top_drains,
        "avg_daily_study_hours": round(avg_study_hours, 1),
        "streak_breaks_last_14_days": streak_breaks,
        "current_streak": stats[-1].streak_count if stats else 0,
    }

async def _ask_ai_for_challenges(summary: dict) -> list:
    prompt = f"""You are a personal productivity coach generating weekly challenges.

User's last 14 days behaviour:
- Average daily study: {summary['avg_daily_study_hours']} hours
- Streak breaks: {summary['streak_breaks_last_14_days']} times
- Current streak: {summary['current_streak']} days
- Top distraction drains: {json.dumps(summary['top_distraction_drains'])}

Generate exactly 3 personalised weekly challenges targeting their actual weaknesses.
Each challenge should be specific, achievable but stretching, and directly tied to data above.

Respond ONLY with a JSON array, no markdown:
[
  {{
    "title": "short catchy title",
    "description": "what the user must do, specific and measurable",
    "metric_type": one of: DISTRACTION_DRAIN_MAX | STUDY_HOURS_MIN | STREAK_DAYS | EXERCISE_COUNT | SLEEP_QUALITY_MIN,
    "metric_target": number,
    "metric_package": "com.instagram.android" or null,
    "reward_type": one of: RUPEE_PAYOUT | MERCY_TOKEN | MULTIPLIER_BOOST,
    "reward_value": integer (rupees if RUPEE_PAYOUT, 1 if MERCY_TOKEN, 20 if MULTIPLIER_BOOST = +0.2x for 3 days),
    "rationale": "one sentence why you chose this challenge for this user"
  }}
]"""

    response = await _call_gemini_text(prompt, max_tokens=600)
    try:
        return json.loads(response)
    except Exception:
        return []   # fallback: no challenges this week

async def update_challenge_progress(db: AsyncSession) -> None:
    """
    Called from midnight audit. Updates current_value for all active challenges
    and awards loot if any are completed.
    """
    result = await db.execute(
        select(AIChallenge).where(AIChallenge.status == ChallengeStatus.ACTIVE)
    )
    active = result.scalars().all()
    today  = datetime.date.today()

    for challenge in active:
        # Check expiry
        if challenge.expires_at < today:
            challenge.status = ChallengeStatus.FAILED
            continue

        # Compute current progress
        current = await _measure_metric(db, challenge)
        challenge.current_value = current

        # Check completion
        completed = False
        if challenge.metric_type == "DISTRACTION_DRAIN_MAX":
            completed = current <= challenge.metric_target   # lower is better
        else:
            completed = current >= challenge.metric_target   # higher is better

        if completed:
            challenge.status       = ChallengeStatus.COMPLETED
            challenge.completed_at = today
            await _award_challenge_reward(db, challenge)

async def _measure_metric(db: AsyncSession, challenge: AIChallenge) -> float:
    """Compute the current metric value for a challenge."""
    start_ms = int(
        datetime.datetime.combine(challenge.generated_at,
                                  datetime.time.min).timestamp() * 1000
    )
    if challenge.metric_type == "DISTRACTION_DRAIN_MAX":
        filters = [
            LedgerEntry.category    == LedgerCategory.DISTRACTION,
            LedgerEntry.timestamp_ms >= start_ms,
        ]
        if challenge.metric_package:
            filters.append(LedgerEntry.description.contains(challenge.metric_package))
        result = await db.execute(
            select(func.coalesce(func.sum(func.abs(LedgerEntry.amount)), 0))
            .where(and_(*filters))
        )
        return result.scalar_one()

    elif challenge.metric_type == "STUDY_HOURS_MIN":
        result = await db.execute(
            select(func.coalesce(func.sum(DailyStats.minutes_worked), 0))
            .where(DailyStats.date >= challenge.generated_at)
        )
        return result.scalar_one() / 60.0

    # Add EXERCISE_COUNT, STREAK_DAYS, SLEEP_QUALITY_MIN similarly
    return 0.0
```

---

## Part 6 — AI Rate Advisor

### How it works

Every Sunday (Salary Day), the AI analyses the past week's economy and generates
rate suggestions. The user sees them as a card on the Settings page with
"Apply" / "Dismiss" buttons per suggestion. Nothing is auto-applied.

### Service: `app/services/rate_advisor.py`

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models.ledger import LedgerEntry, LedgerCategory
from app.models.stats import DailyStats
from app.models.rules import DistractionRule
from app.services.ai_service import _call_gemini_text
from app.services.economy_service import get_settings
import json, datetime

async def generate_rate_suggestions(db: AsyncSession) -> list[dict]:
    """
    Analyses last 7 days of economy data and returns rate adjustment suggestions.
    Called weekly by APScheduler on Salary Day.
    Suggestions are stored in a `rate_suggestions` table and served via GET /settings/suggestions.
    User approves/dismisses each one individually.
    """
    settings = await get_settings(db)
    summary  = await _build_economy_summary(db, settings)
    prompt   = _build_advisor_prompt(summary, settings)
    response = await _call_gemini_text(prompt, max_tokens=800)

    try:
        suggestions = json.loads(response)
        # Persist suggestions to DB for the frontend to read
        await _save_suggestions(db, suggestions)
        return suggestions
    except Exception:
        return []

async def _build_economy_summary(db: AsyncSession, settings) -> dict:
    seven_days_ago_ms = int(
        (datetime.datetime.now() - datetime.timedelta(days=7)).timestamp() * 1000
    )
    seven_days_ago = datetime.date.today() - datetime.timedelta(days=7)

    # Total earned vs spent this week
    earned_result = await db.execute(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0))
        .where(and_(
            LedgerEntry.amount > 0,
            LedgerEntry.timestamp_ms >= seven_days_ago_ms,
        ))
    )
    spent_result = await db.execute(
        select(func.coalesce(func.sum(func.abs(LedgerEntry.amount)), 0))
        .where(and_(
            LedgerEntry.amount < 0,
            LedgerEntry.timestamp_ms >= seven_days_ago_ms,
        ))
    )
    earned = earned_result.scalar_one()
    spent  = spent_result.scalar_one()

    # Drain per app
    drain_by_app_result = await db.execute(
        select(LedgerEntry.merchant_name,
               func.sum(func.abs(LedgerEntry.amount)).label("drain"))
        .where(and_(
            LedgerEntry.category == LedgerCategory.DISTRACTION,
            LedgerEntry.timestamp_ms >= seven_days_ago_ms,
        ))
        .group_by(LedgerEntry.merchant_name)
        .order_by(func.sum(func.abs(LedgerEntry.amount)).desc())
    )
    drain_by_app = [{"app": r[0], "drain": r[1]}
                    for r in drain_by_app_result.all() if r[0]]

    # Distraction rules for context
    rules_result = await db.execute(select(DistractionRule))
    rules = [{"app": r.app_label, "cpm": r.cost_per_minute,
               "surge_cpm": r.surge_cost_per_minute}
             for r in rules_result.scalars().all()]

    # NFC sessions this week
    nfc_sessions_result = await db.execute(
        select(func.count(), func.coalesce(func.sum(LedgerEntry.amount), 0))
        .where(and_(
            LedgerEntry.category == LedgerCategory.NFC,
            LedgerEntry.timestamp_ms >= seven_days_ago_ms,
        ))
    )
    row = nfc_sessions_result.one()
    nfc_count, nfc_earned = row[0], row[1]

    # Days target was hit
    stats_result = await db.execute(
        select(DailyStats).where(DailyStats.date >= seven_days_ago)
    )
    stats = stats_result.scalars().all()
    days_target_hit = sum(1 for s in stats if s.target_hit)

    return {
        "weekly_earned": earned,
        "weekly_spent": spent,
        "net": earned - spent,
        "drain_by_app": drain_by_app,
        "current_rules": rules,
        "nfc_sessions": nfc_count,
        "nfc_earned": nfc_earned,
        "days_target_hit": days_target_hit,
        "current_hourly_rate": settings.hourly_earn_rate,
        "current_lazy_tax": settings.lazy_tax_amount,
        "daily_target_hours": settings.daily_target_hours,
    }

def _build_advisor_prompt(summary: dict, settings) -> str:
    return f"""You are an AI economy advisor for a personal productivity app.
The app tracks virtual ₹ earnings (study) vs spending (distractions, UPI debits).

This week's economy summary:
- Earned: ₹{summary['weekly_earned']} | Spent: ₹{summary['weekly_spent']} | Net: ₹{summary['net']}
- NFC study sessions: {summary['nfc_sessions']} | Study days on target: {summary['days_target_hit']}/7
- Current hourly earn rate: ₹{summary['current_hourly_rate']}/hr
- Current lazy tax: ₹{summary['current_lazy_tax']}
- Daily study target: {summary['daily_target_hours']} hours
- Distraction drain by app: {json.dumps(summary['drain_by_app'])}
- Current distraction rules: {json.dumps(summary['current_rules'])}

Based on this data, suggest 2-4 specific rate adjustments. Each suggestion must:
1. Be data-driven (reference actual numbers from the summary above)
2. Make the economy healthier (if earning >> spending: increase rates to challenge;
   if spending >> earning: adjust distraction rates or earn rate to rebalance)
3. Include what will change and why

Respond ONLY with a JSON array, no markdown:
[
  {{
    "field": "hourly_earn_rate" | "lazy_tax_amount" | "distraction_cost_per_minute" | "surge_cost_per_minute",
    "target_package": "com.instagram.android" or null (only for distraction rules),
    "current_value": number,
    "suggested_value": number,
    "reason": "specific one-sentence explanation referencing actual data",
    "impact": "what this change will do to the economy balance"
  }}
]"""
```

### Rate Suggestions Table + Router

```python
# app/models/suggestion.py
class RateSuggestion(Base):
    __tablename__ = "rate_suggestions"

    id:              Mapped[int]  = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    field:           Mapped[str]  = mapped_column(String(100), nullable=False)
    target_package:  Mapped[str]  = mapped_column(String(200), nullable=True)
    current_value:   Mapped[int]  = mapped_column(Integer, nullable=False)
    suggested_value: Mapped[int]  = mapped_column(Integer, nullable=False)
    reason:          Mapped[str]  = mapped_column(String(500), nullable=False)
    impact:          Mapped[str]  = mapped_column(String(300), nullable=False)
    status:          Mapped[str]  = mapped_column(String(20), default="PENDING")
    # "PENDING" | "APPLIED" | "DISMISSED"
    generated_at:    Mapped[int]  = mapped_column(BigInteger,
                         default=lambda: int(time.time() * 1000))
```

```python
# In app/routers/settings.py — add two new endpoints:

@router.get("/suggestions")
async def get_rate_suggestions(db: AsyncSession = Depends(get_db)):
    """Returns pending AI rate suggestions for the Settings page."""
    result = await db.execute(
        select(RateSuggestion).where(RateSuggestion.status == "PENDING")
        .order_by(RateSuggestion.generated_at.desc())
    )
    return result.scalars().all()

@router.post("/suggestions/{suggestion_id}/apply")
async def apply_suggestion(suggestion_id: int, db: AsyncSession = Depends(get_db)):
    """User clicks Apply on a suggestion. Updates the actual setting or rule."""
    result  = await db.execute(
        select(RateSuggestion).where(RateSuggestion.id == suggestion_id)
    )
    s = result.scalar_one_or_none()
    if not s or s.status != "PENDING":
        raise HTTPException(status_code=404, detail="Suggestion not found")

    settings = await get_settings(db)

    if s.field == "hourly_earn_rate":
        settings.hourly_earn_rate = s.suggested_value
    elif s.field == "lazy_tax_amount":
        settings.lazy_tax_amount = s.suggested_value
    elif s.field == "distraction_cost_per_minute" and s.target_package:
        rule_result = await db.execute(
            select(DistractionRule).where(DistractionRule.package_name == s.target_package)
        )
        rule = rule_result.scalar_one_or_none()
        if rule:
            rule.cost_per_minute = s.suggested_value
    elif s.field == "surge_cost_per_minute" and s.target_package:
        rule_result = await db.execute(
            select(DistractionRule).where(DistractionRule.package_name == s.target_package)
        )
        rule = rule_result.scalar_one_or_none()
        if rule:
            rule.surge_cost_per_minute = s.suggested_value

    s.status = "APPLIED"
    await db.commit()
    return {"status": "applied", "field": s.field, "new_value": s.suggested_value}

@router.post("/suggestions/{suggestion_id}/dismiss")
async def dismiss_suggestion(suggestion_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RateSuggestion).where(RateSuggestion.id == suggestion_id)
    )
    s = result.scalar_one_or_none()
    if s:
        s.status = "DISMISSED"
        await db.commit()
    return {"status": "dismissed"}
```

---

## Scheduler additions for `app/main.py`

```python
from app.services.achievement_service import generate_weekly_challenges
from app.services.rate_advisor import generate_rate_suggestions

scheduler.add_job(
    generate_weekly_challenges_job,
    CronTrigger(day_of_week="mon", hour=6, minute=0),  # Every Monday 6 AM
    id="weekly_challenges",
    replace_existing=True,
)
scheduler.add_job(
    generate_rate_suggestions_job,
    CronTrigger(day_of_week="sun", hour=20, minute=0),  # Salary Day 8 PM
    id="rate_advisor",
    replace_existing=True,
)

async def generate_weekly_challenges_job():
    async with AsyncSessionLocal() as db:
        await generate_weekly_challenges(db)
        await db.commit()

async def generate_rate_suggestions_job():
    async with AsyncSessionLocal() as db:
        await generate_rate_suggestions(db)
        await db.commit()
```

Also add challenge progress update to the existing midnight audit:

```python
# In audit_service.py _audit(), add at the end:
from app.services.achievement_service import update_challenge_progress
await update_challenge_progress(db)
```

---

## Frontend additions summary (for Lovable / agent)

### New page: Wellness Dashboard (`/wellness`)
Sidebar icon: `Moon` (Lucide). Between Dashboard and Ledger.

**Sections:**
1. **Sleep card** — large button "Going to Sleep 🌙" / "Good Morning ☀️" depending on `is_sleeping` state. Shows current elapsed sleep time if sleeping. Below: 30-day sleep quality heatmap (colour: grey=no data, green=excellent, yellow=good, orange=adequate, red=poor/bad). Shows today's sleep multiplier effect prominently.

2. **Exercise log card** — "Log Exercise" button opens modal: exercise type selector + duration input. Shows today's exercise entries. Shows step income alongside (all physical activity income in one place as spec'd).

3. **Today's physical earnings** — a mini ledger showing only STEP_INCOME and exercise entries for today: steps ₹50, run ₹66, total ₹116 physical income today.

### Changes to Settings page
Add a new section at the top of Settings: **"AI Rate Suggestions"**
- Only shown when there are PENDING suggestions (hide section otherwise)
- Each suggestion rendered as a card: current value → suggested value, reason, impact
- Two buttons per card: "Apply" (green) and "Dismiss" (ghost)
- After apply/dismiss, card slides out with Framer Motion exit animation

### Changes to Achievements page
Replace static badge shelf with:
- **Active Challenges** (3 cards, AI-generated weekly) — each with a progress bar, reward preview, days remaining, and the AI's rationale in small muted text
- **Boss Fights** (unchanged, stays here)
- **Completed / Failed challenges** history at the bottom

### New: Manual Deduction button
Add to the Ledger page header: "Apply Penalty" button (red outline).
Opens a modal with:
- Amount input (₹)
- Reason textarea (min 20 chars, character counter shown)
- Category selector: Self-Penalty / Habit Breach / Rule Violation / Custom
- "Submit for AI Review" button
- AI response shown inline after submit:
  - If APPROVED: green banner "Approved — ₹X deducted"
  - If REDUCED: amber banner "Reduced to ₹X — [reasoning]"  
  - If REJECTED: red banner + "Override anyway (+20% tax)" secondary button + "Cancel" primary

### Real-time balance in header
The `useEconomyStream` hook should feed balance updates to a global Zustand store.
The sidebar balance display updates live when a drain/earn/upi SSE event arrives —
no page reload needed.
