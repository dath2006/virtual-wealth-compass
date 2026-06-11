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


async def start_sleep(db: AsyncSession, device_id: str = "web") -> SleepSession:
    """Called when user taps 'Going to sleep' on Android or web."""
    # Check if there's already an open sleep session
    result = await db.execute(
        select(SleepSession).where(SleepSession.wake_at_ms.is_(None)).limit(1)
    )
    existing = result.scalar_one_or_none()
    if existing:
        # Already sleeping — idempotent, return existing
        return existing

    session = SleepSession(
        sleep_at_ms=int(time.time() * 1000),
        source="MANUAL"
    )
    db.add(session)
    await db.flush()
    return session


async def end_sleep(db: AsyncSession, device_id: str = "web") -> dict:
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

    if duration_hours < 1.0:
        await db.delete(session)
        return {
            "skipped": True,
            "duration_hours": round(duration_hours, 2),
            "message": f"Sleep session too short ({duration_hours:.2f}h). Minimum 1 hour required. Session discarded."
        }

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
    stats.sleep_multiplier = multiplier

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
        category=LedgerCategory.SLEEP_EVENT,
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
