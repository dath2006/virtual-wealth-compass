from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.stats import DailyStats, AppSettings
import datetime

async def get_settings(db: AsyncSession) -> AppSettings:
    result = await db.execute(select(AppSettings).where(AppSettings.id == 1))
    settings = result.scalar_one_or_none()
    if settings is None:
        # Create default settings on first run
        settings = AppSettings(id=1)
        db.add(settings)
        await db.flush()
    return settings

async def get_or_create_daily_stats(db: AsyncSession) -> DailyStats:
    today = datetime.date.today()
    result = await db.execute(select(DailyStats).where(DailyStats.date == today))
    stats = result.scalar_one_or_none()

    if stats is None:
        # Inherit streak + credit score from yesterday
        yesterday = today - datetime.timedelta(days=1)
        result2 = await db.execute(select(DailyStats).where(DailyStats.date == yesterday))
        prev = result2.scalar_one_or_none()

        stats = DailyStats(
            date=today,
            streak_count=prev.streak_count if prev else 0,
            earning_multiplier=prev.earning_multiplier if prev else 1.0,
            credit_score=prev.credit_score if prev else 600,
            mercy_tokens=prev.mercy_tokens if prev else 1,
        )
        db.add(stats)
        await db.flush()
    return stats

async def get_current_multiplier(db: AsyncSession) -> float:
    stats = await get_or_create_daily_stats(db)
    return stats.earning_multiplier

def compute_multiplier(streak_days: int) -> float:
    """
    Streak multiplier scale:
    0 days  → 1.0×
    3 days  → 1.2×
    5 days  → 1.5×
    7+ days → 2.0×
    """
    if streak_days >= 7:  return 2.0
    if streak_days >= 5:  return 1.5
    if streak_days >= 3:  return 1.2
    return 1.0

async def add_work_minutes(db: AsyncSession, minutes: int) -> None:
    stats = await get_or_create_daily_stats(db)
    stats.minutes_worked += minutes

async def credit_score_for_tier(score: int) -> dict:
    """Returns loan terms based on credit score tier."""
    if score >= 800:
        return {"tier": "PLATINUM", "interest_rate": 0.02, "max_days": 30}
    elif score >= 600:
        return {"tier": "GOLD",     "interest_rate": 0.035, "max_days": 21}
    elif score >= 400:
        return {"tier": "SILVER",   "interest_rate": 0.05,  "max_days": 14}
    else:
        return {"tier": "DEFAULTER","interest_rate": 0.08,  "max_days": 7}
