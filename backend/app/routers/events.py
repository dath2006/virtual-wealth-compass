from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.schemas.events import EventEnvelope, UpiDebitPayload, NfcSessionPayload
from app.schemas.events import UsageReportPayload, StepsPayload, HeartbeatPayload
from app.services import ledger_service, economy_service, ai_service
from app.models.ledger import LedgerCategory, SpendClass
from app.models.session import NfcSession
from app.models.device import DeviceHeartbeat
from app.models.usage import UsageSnapshot
from app.services.sse_manager import sse_manager
import datetime
import json
import time

router = APIRouter(prefix="/events", dependencies=[Depends(verify_api_key)])

# ── POST /events/upi ──────────────────────────────────────────────────────────
@router.post("/upi")
async def receive_upi_debit(envelope: EventEnvelope, db: AsyncSession = Depends(get_db)):
    payload = UpiDebitPayload(**envelope.payload)

    # 1. Deduplication — reject if we've seen this dedup_key before
    if await ledger_service.check_dedup(db, payload.dedup_key):
        return {"status": "duplicate", "message": "Transaction already recorded"}

    # ── Check for active Activity Pass covering this transaction ─────────────
    from app.routers.marketplace import try_consume_activity_pass

    pass_consumed = await try_consume_activity_pass(
        db=db,
        merchant_name=payload.merchant_name,
        amount=payload.amount_rupees,
        dedup_key=payload.dedup_key,
    )

    if pass_consumed:
        # Pass covered this spend — zero virtual cost, still record it
        await ledger_service.insert_entry(
            db=db,
            amount=0,
            category=LedgerCategory.NOTIFICATION_UPI if payload.source != "SMS" else LedgerCategory.SMS_UPI,
            description=f"Covered by pass: {payload.merchant_name or 'Payment'} ₹{payload.amount_rupees}",
            merchant_name=payload.merchant_name,
            spend_class=SpendClass.ESSENTIAL,
            dedup_key=payload.dedup_key,
            device_id=envelope.device_id,
        )
        balance = await ledger_service.get_balance(db)
        return {
            "status": "ok",
            "balance": balance,
            "notification": {
                "title": f"✅ Pass used! ₹{payload.amount_rupees} at {payload.merchant_name or 'merchant'}",
                "body": f"Covered by your active pass. Zero virtual cost. Balance: ₹{balance}",
                "priority": "default"
            }
        }

    # 2. AI classification — essential vs discretionary
    spend_class_str, ai_verified = await ai_service.classify_transaction(
        merchant_name=payload.merchant_name,
        amount=payload.amount_rupees,
        raw_text=payload.raw_text,
    )
    spend_class = SpendClass(spend_class_str)

    # 3. Penalty multiplier — essential = free, discretionary = full cost, unknown = half
    multiplier = {"ESSENTIAL": 0.0, "DISCRETIONARY": 1.0, "UNKNOWN": 0.5}[spend_class_str]
    virtual_cost = int(payload.amount_rupees * multiplier)

    if virtual_cost == 0:
        desc = f"Essential spend at {payload.merchant_name or 'merchant'} — no virtual penalty"
        amount = 0
    else:
        desc = f"UPI: {payload.merchant_name or 'Payment'} — ₹{payload.amount_rupees} real"
        amount = -virtual_cost

    # 4. Insert ledger entry (only if there's a cost)
    if amount != 0:
        await ledger_service.insert_entry(
            db=db,
            amount=amount,
            category=LedgerCategory.SMS_UPI if payload.source == "SMS" else LedgerCategory.NOTIFICATION_UPI,
            description=desc,
            merchant_name=payload.merchant_name,
            spend_class=spend_class,
            dedup_key=payload.dedup_key,
            device_id=envelope.device_id,
            is_verified_by_ai=ai_verified,
            raw_payload=json.dumps(envelope.payload)[:500],
        )

    balance = await ledger_service.get_balance(db)

    # Push SSE event to live browser dashboard
    if amount != 0:
        await sse_manager.push({
            "type":     "upi",
            "merchant": payload.merchant_name or "Payment",
            "amount":   amount,
            "balance":  balance,
        })

    notification = None

    if balance < 0:
        notification = {
            "title": "⚠ You're bankrupt!",
            "body": f"Debt: ₹{abs(balance)}. Tap your desk tag to work it off.",
            "priority": "bankrupt"
        }
    elif amount != 0:
        notification = {
            "title": f"₹{payload.amount_rupees} spent at {payload.merchant_name or 'merchant'}",
            "body": f"Virtual cost: ₹{abs(amount)} ({spend_class_str}). Balance: ₹{balance}",
            "priority": "default"
        }

    return {"status": "ok", "balance": balance, "notification": notification}


# ── POST /events/nfc ──────────────────────────────────────────────────────────
@router.post("/nfc")
async def receive_nfc_tap(envelope: EventEnvelope, db: AsyncSession = Depends(get_db)):
    """
    NFC tap is stateless on Android — the server decides START vs STOP
    based on whether there's an open session for this tag_id + device_id.
    """
    from sqlalchemy import select, and_
    payload = NfcSessionPayload(**envelope.payload)

    # Check for open session
    result = await db.execute(
        select(NfcSession).where(
            and_(
                NfcSession.tag_id == payload.tag_id,
                NfcSession.device_id == envelope.device_id,
                NfcSession.is_open == True,
            )
        ).limit(1)
    )
    open_session = result.scalar_one_or_none()

    if open_session is None:
        # ── START new session ──
        session = NfcSession(
            tag_id=payload.tag_id,
            tag_label=payload.tag_label,
            device_id=envelope.device_id,
            start_ms=envelope.timestamp_ms,
            is_open=True,
        )
        db.add(session)
        await db.flush()

        return {
            "status": "ok",
            "action": "session_started",
            "session_id": session.id,
            "notification": {
                "title": "🎯 Focus session started",
                "body": f"Tag: {payload.tag_label}. Tap again to stop and earn.",
                "priority": "default"
            }
        }
    else:
        # ── STOP session — compute earnings ──
        end_ms    = envelope.timestamp_ms
        elapsed   = end_ms - open_session.start_ms
        minutes   = elapsed / 60_000

        # Minimum session: 5 minutes
        if minutes < 5:
            open_session.is_open = False
            open_session.end_ms = end_ms
            open_session.duration_minutes = round(minutes, 1)
            return {
                "status": "ok",
                "action": "session_too_short",
                "notification": {
                    "title": "Session too short",
                    "body": "Minimum 5 minutes needed to earn. Keep going!",
                    "priority": "default"
                }
            }

        # Get current streak multiplier from daily_stats
        multiplier = await economy_service.get_current_multiplier(db)
        settings   = await economy_service.get_settings(db)
        hourly     = settings.hourly_earn_rate
        base       = int((minutes / 60) * hourly)
        final      = int(base * multiplier)

        # Update session record
        open_session.end_ms          = end_ms
        open_session.duration_minutes = minutes
        open_session.base_earned     = base
        open_session.multiplier      = multiplier
        open_session.final_earned    = final
        open_session.is_open         = False

        # Insert ledger entry
        entry = await ledger_service.insert_entry(
            db=db,
            amount=final,
            category=LedgerCategory.NFC,
            description=f"Focus session: {int(minutes//60)}h {int(minutes%60)}m ({payload.tag_label})",
            device_id=envelope.device_id,
        )
        open_session.ledger_entry_id = entry.id

        # Update today's daily stats
        await economy_service.add_work_minutes(db, int(minutes))

        # ── Progress active boss fights with this session's duration ──────────────
        from app.services.boss_service import progress_boss_fights

        beaten_bosses = await progress_boss_fights(
            db=db,
            session_minutes=minutes,
        )

        balance = await ledger_service.get_balance(db)

        # Push SSE event: study session earned
        await sse_manager.push({
            "type":   "earn",
            "source": "NFC",
            "amount": final,
            "balance": balance,
        })

        # Build notification body — include boss completion if any fired
        base_notif_body = (
            f"{int(minutes)}min × ₹{hourly}/hr × {multiplier}× = ₹{final}. "
            f"Balance: ₹{balance}"
        )

        if beaten_bosses:
            boss_names = ", ".join(b["title"] for b in beaten_bosses)
            base_notif_body += f" 🏆 BOSS CLEARED: {boss_names}!"

        return {
            "status": "ok",
            "action": "session_stopped",
            "earned": final,
            "duration_minutes": round(minutes, 1),
            "multiplier": multiplier,
            "beaten_bosses": beaten_bosses,   # new field for Android to show special UI
            "notification": {
                "title": f"✅ Session complete! Earned ₹{final}",
                "body": base_notif_body,
                "priority": "high" if beaten_bosses else "default"
            }
        }


# ── POST /events/usage ────────────────────────────────────────────────────────
@router.post("/usage")
async def receive_usage_report(envelope: EventEnvelope, db: AsyncSession = Depends(get_db)):
    """
    Receives app usage report from Android (every 30 min).
    Stores raw data — distraction drain is applied during midnight audit,
    not in real-time, to avoid charging the user mid-scroll.
    """
    payload = UsageReportPayload(**envelope.payload)

    snapshot = UsageSnapshot(
        device_id=envelope.device_id,
        period_start_ms=payload.period_start_ms,
        period_end_ms=payload.period_end_ms,
        app_usages_json=json.dumps([u.model_dump() for u in payload.app_usages]),
        processed=False,
    )
    db.add(snapshot)
    return {"status": "ok", "message": "Usage data received"}


# ── POST /events/steps ────────────────────────────────────────────────────────
@router.post("/steps")
async def receive_steps(envelope: EventEnvelope, db: AsyncSession = Depends(get_db)):
    payload = StepsPayload(**envelope.payload)

    # Check if today's step income was already credited
    today_stats = await economy_service.get_or_create_daily_stats(db)
    if today_stats.step_income_credited:
        return {"status": "ok", "message": "Step income already credited today"}

    # Tiered step income
    settings = await economy_service.get_settings(db)
    cap = settings.step_income_cap
    earned = 0
    if payload.steps_today >= 10_000:
        earned = cap
    elif payload.steps_today >= 8_000:
        earned = int(cap * 0.8)
    elif payload.steps_today >= 5_000:
        earned = int(cap * 0.5)

    if earned > 0:
        await ledger_service.insert_entry(
            db=db,
            amount=earned,
            category=LedgerCategory.STEP_INCOME,
            description=f"{payload.steps_today:,} steps today",
            device_id=envelope.device_id,
        )
        today_stats.step_income_credited = True

    balance = await ledger_service.get_balance(db)

    # Push SSE event: step income earned
    if earned > 0:
        await sse_manager.push({
            "type":   "earn",
            "source": "STEPS",
            "amount": earned,
            "balance": balance,
        })

    return {"status": "ok", "earned": earned, "balance": balance}


# ── POST /events/heartbeat ────────────────────────────────────────────────────
@router.post("/heartbeat")
async def receive_heartbeat(envelope: EventEnvelope, db: AsyncSession = Depends(get_db)):
    """
    15-minute ping from Android service. Used to:
    - Confirm device is alive
    - Push back current balance + any pending notifications
    """
    payload = HeartbeatPayload(**envelope.payload)

    # Upsert heartbeat record
    from sqlalchemy import select
    result = await db.execute(
        select(DeviceHeartbeat).where(DeviceHeartbeat.device_id == envelope.device_id)
    )
    heartbeat = result.scalar_one_or_none()
    if heartbeat is None:
        heartbeat = DeviceHeartbeat(device_id=envelope.device_id)
        db.add(heartbeat)

    heartbeat.last_seen_ms = envelope.timestamp_ms
    heartbeat.battery_pct  = payload.battery_pct
    heartbeat.is_charging  = payload.is_charging

    balance = await ledger_service.get_balance(db)
    today   = await economy_service.get_or_create_daily_stats(db)

    notification = None
    if balance < 0:
        notification = {
            "title": f"⚠ Bankrupt — ₹{abs(balance)} debt",
            "body": "Tap your desk tag to work it off.",
            "priority": "bankrupt"
        }

    from app.routers.marketplace import get_active_pass_for_heartbeat
    active_pass = await get_active_pass_for_heartbeat(db)

    return {
        "status": "ok",
        "balance": balance,
        "streak": today.streak_count,
        "multiplier": today.earning_multiplier,
        "active_pass": active_pass,
        "notification": notification
    }


# ── POST /events/usage_session ────────────────────────────────────────────────

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

    surge_tag = " ⚡ surge" if is_surge else ""
    await ledger_service.insert_entry(
        db=db,
        amount=-penalty,
        category=LedgerCategory.DISTRACTION,
        description=f"{int(payload.minutes)}min on {rule.app_label} (₹{cost_per_min}/min{surge_tag})",
        merchant_name=rule.app_label,
    )

    balance = await ledger_service.get_balance(db)

    # Push SSE event to browser dashboard
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

    await db.commit()
    return {
        "status":   "ok",
        "drained":  penalty,
        "balance":  balance,
        "surge":    is_surge,
        "notification": notification
    }


def _pass_covers_package(pass_type: str, package_name: str) -> bool:
    """Mirrors the Android isPassCoveringApp logic server-side."""
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
