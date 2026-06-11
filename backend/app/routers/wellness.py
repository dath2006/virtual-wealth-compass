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
    from app.services.economy_service import get_settings
    settings    = await get_settings(db)
    rate_per_10 = await get_exercise_earn_rate(req.exercise_type, settings)
    earned      = int((req.duration_minutes / 10) * rate_per_10)

    entry = await ledger_service.insert_entry(
        db=db,
        amount=earned,
        category=LedgerCategory.EXERCISE_INCOME,
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

    sleep_sessions    = sleep_result.scalars().all()
    exercise_sessions = exercise_result.scalars().all()
    daily_stats       = stats_result.scalars().all()

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
