import datetime
import logging
import json
from sqlalchemy import select, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.ledger import LedgerCategory
from app.models.oath import Oath, OathStatus
from app.models.stats import DailyStats
from app.models.rules import DistractionRule, SpendingCap
from app.models.usage import UsageSnapshot
from app.services import ledger_service, economy_service, boss_service

logger = logging.getLogger("audit")

async def run_midnight_audit(audit_date: datetime.date | None = None):
    """
    Called by APScheduler at 00:00 every day.
    Creates its own DB session — does not depend on a request context.
    """
    async with AsyncSessionLocal() as db:
        try:
            await _audit(db, audit_date)
            await db.commit()
            logger.info("Midnight audit completed successfully")
        except Exception as e:
            await db.rollback()
            logger.error(f"Midnight audit failed: {e}")
            raise e

async def get_or_create_stats_for_date(db: AsyncSession, target_date: datetime.date) -> DailyStats:
    result = await db.execute(select(DailyStats).where(DailyStats.date == target_date))
    stats = result.scalar_one_or_none()
    if stats is None:
        # Find the most recent stats before target_date to inherit values
        result_prev = await db.execute(
            select(DailyStats)
            .where(DailyStats.date < target_date)
            .order_by(DailyStats.date.desc())
            .limit(1)
        )
        prev = result_prev.scalar_one_or_none()
        stats = DailyStats(
            date=target_date,
            streak_count=prev.streak_count if prev else 0,
            earning_multiplier=prev.earning_multiplier if prev else 1.0,
            credit_score=prev.credit_score if prev else 600,
            mercy_tokens=prev.mercy_tokens if prev else 1,
        )
        db.add(stats)
        await db.flush()
    return stats

async def _audit(db: AsyncSession, audit_date: datetime.date | None = None):
    if audit_date is None:
        yesterday = datetime.date.today() - datetime.timedelta(days=1)
        today = datetime.date.today()
    else:
        yesterday = audit_date
        today = yesterday + datetime.timedelta(days=1)

    logger.info(f"Starting audit for yesterday: {yesterday} (today: {today})")
    settings = await economy_service.get_settings(db)

    # ── 1. Distraction drain ─────────────────────────────────────────────────
    # Get yesterday's start and end times in local millisecond timestamps
    day_start = int(datetime.datetime.combine(yesterday, datetime.time.min).timestamp() * 1000)
    day_end = int(datetime.datetime.combine(yesterday, datetime.time.max).timestamp() * 1000)

    result_snaps = await db.execute(
        select(UsageSnapshot).where(
            and_(
                UsageSnapshot.period_start_ms >= day_start,
                UsageSnapshot.period_start_ms <= day_end,
                UsageSnapshot.processed == False,
            )
        )
    )
    snapshots = result_snaps.scalars().all()

    # Query all distraction rules
    rules_result = await db.execute(select(DistractionRule))
    rules = {r.package_name: r for r in rules_result.scalars().all()}

    package_penalties = {}
    package_minutes = {}

    for snap in snapshots:
        # Convert period_start_ms to local hour to check for surge (study) hours
        snap_time = datetime.datetime.fromtimestamp(snap.period_start_ms / 1000.0)
        snap_hour = snap_time.hour
        is_study_hour = (settings.study_hours_start <= snap_hour < settings.study_hours_end)

        try:
            usages = json.loads(snap.app_usages_json)
            for u in usages:
                pkg = u["package_name"]
                mins = u["minutes_used"]
                rule = rules.get(pkg)
                if not rule or mins <= 0:
                    continue

                effective_cost = rule.surge_cost_per_minute if (rule.is_surge_enabled and is_study_hour) else rule.cost_per_minute
                penalty = mins * effective_cost

                package_penalties[pkg] = package_penalties.get(pkg, 0) + penalty
                package_minutes[pkg] = package_minutes.get(pkg, 0) + mins
        except Exception as e:
            logger.error(f"Error parsing snapshot {snap.id}: {e}")

        snap.processed = True

    yesterday_stats = await get_or_create_stats_for_date(db, yesterday)
    today_stats = await get_or_create_stats_for_date(db, today)

    # Insert distraction penalties to ledger and update yesterday's stats spent amount
    total_distraction_penalty = 0
    for pkg, penalty in package_penalties.items():
        if penalty > 0:
            rule = rules[pkg]
            mins = package_minutes[pkg]
            avg_rate = penalty / mins if mins > 0 else rule.cost_per_minute
            await ledger_service.insert_entry(
                db=db,
                amount=-penalty,
                category=LedgerCategory.DISTRACTION,
                description=f"App distraction: {mins}m on {rule.app_label} (avg ₹{avg_rate:.1f}/m)",
                merchant_name=rule.app_label,
                device_id=snapshots[0].device_id if snapshots else None,
            )
            total_distraction_penalty += penalty

    yesterday_stats.amount_spent += total_distraction_penalty
    logger.info(f"Distraction drain applied: ₹{total_distraction_penalty}")

    # ── 2. Streak evaluation ─────────────────────────────────────────────────
    target_minutes = settings.daily_target_hours * 60
    threshold = settings.lazy_tax_threshold_pct
    completion = yesterday_stats.minutes_worked / target_minutes if target_minutes > 0 else 0

    if completion >= 1.0:
        # Full day — increment streak, boost multiplier
        new_streak = yesterday_stats.streak_count + 1
        today_stats.streak_count = new_streak
        today_stats.earning_multiplier = economy_service.compute_multiplier(new_streak)
        yesterday_stats.target_hit = True
        logger.info(f"Streak incremented to {new_streak} days, multiplier: {today_stats.earning_multiplier}×")

    elif completion >= threshold:
        # Partial day — hold streak, don't grow multiplier
        today_stats.streak_count = yesterday_stats.streak_count
        today_stats.earning_multiplier = yesterday_stats.earning_multiplier
        logger.info(f"Partial day completed ({int(completion*100)}%) — streak held at {today_stats.streak_count}")

    else:
        # Missed day — check mercy tokens
        if yesterday_stats.mercy_tokens > 0:
            yesterday_stats.mercy_tokens -= 1
            today_stats.streak_count = yesterday_stats.streak_count  # streak saved
            today_stats.earning_multiplier = yesterday_stats.earning_multiplier
            logger.info(f"Mercy token used — streak saved at {today_stats.streak_count}")
        else:
            # Hard reset
            today_stats.streak_count = 0
            today_stats.earning_multiplier = 1.0
            yesterday_stats.lazy_tax_applied = True

            await ledger_service.insert_entry(
                db=db,
                amount=-settings.lazy_tax_amount,
                category=LedgerCategory.LAZY_TAX,
                description=f"Lazy tax — {int(completion*100)}% of daily target completed",
            )
            yesterday_stats.amount_spent += settings.lazy_tax_amount
            logger.info(f"Lazy tax applied: ₹{settings.lazy_tax_amount}")

    # Carry mercy tokens and credit score forward
    today_stats.mercy_tokens = yesterday_stats.mercy_tokens
    today_stats.credit_score = yesterday_stats.credit_score

    # ── 3. Monthly mercy token grant (1 per month) ───────────────────────────
    if today.day == 1:
        today_stats.mercy_tokens = min(today_stats.mercy_tokens + 1, 3)
        logger.info("Monthly mercy token granted")

    # ── 4. Oath compound interest ────────────────────────────────────────────
    now_ms = int(datetime.datetime.now().timestamp() * 1000)
    result_oaths = await db.execute(
        select(Oath).where(
            and_(
                Oath.status.in_([OathStatus.ACTIVE, OathStatus.OVERDUE]),
                Oath.due_date_ms < now_ms
            )
        )
    )
    overdue_oaths = result_oaths.scalars().all()

    for oath in overdue_oaths:
        if oath.status == OathStatus.ACTIVE:
            oath.status = OathStatus.OVERDUE

        interest = int(oath.current_debt_amount * oath.daily_interest_rate)
        if interest == 0 and oath.daily_interest_rate > 0 and oath.current_debt_amount > 0:
            interest = 1

        if interest > 0:
            oath.current_debt_amount += interest
            await ledger_service.insert_entry(
                db=db,
                amount=-interest,
                category=LedgerCategory.OATH_INTEREST,
                description=f"Overdue interest on Oath #{oath.id}: {oath.task_description[:50]}",
            )
            yesterday_stats.amount_spent += interest
            logger.info(f"Oath #{oath.id} interest: ₹{interest}")

    # ── 5. Monthly spending cap reset ────────────────────────────────────────
    if today.day == 1:
        await db.execute(update(SpendingCap).values(current_month_spent=0))
        logger.info("Monthly spending caps reset")

    # ── 6. Fail expired boss fights ─────────────────────────────────────────
    await boss_service.fail_expired_boss_fights(db)

    # ── 7. AI challenge progress ──────────────────────────────────────────────────
    from app.services.achievement_service import update_challenge_progress
    await update_challenge_progress(db)
    logger.info("AI challenge progress updated")
