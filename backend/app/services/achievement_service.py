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

    elif challenge.metric_type == "STREAK_DAYS":
        result = await db.execute(
            select(DailyStats)
            .where(DailyStats.date >= challenge.generated_at)
            .order_by(DailyStats.date.desc())
            .limit(1)
        )
        latest = result.scalar_one_or_none()
        return latest.streak_count if latest else 0.0

    # EXERCISE_COUNT, SLEEP_QUALITY_MIN — extensible
    return 0.0


async def _award_challenge_reward(db: AsyncSession, challenge: AIChallenge) -> None:
    """Award the reward for a completed challenge."""
    if challenge.reward_type == RewardType.RUPEE_PAYOUT:
        await ledger_service.insert_entry(
            db=db,
            amount=challenge.reward_value,
            category=LedgerCategory.BOSS_REWARD,
            description=f"Challenge completed: {challenge.title}",
        )
    elif challenge.reward_type == RewardType.MERCY_TOKEN:
        # Grant mercy token to today's stats
        today_result = await db.execute(
            select(DailyStats).where(DailyStats.date == datetime.date.today())
        )
        today_stats = today_result.scalar_one_or_none()
        if today_stats:
            today_stats.mercy_tokens = min(today_stats.mercy_tokens + 1, 3)
    elif challenge.reward_type == RewardType.MULTIPLIER_BOOST:
        # +0.2× multiplier for next 3 days
        today_result = await db.execute(
            select(DailyStats).where(DailyStats.date == datetime.date.today())
        )
        today_stats = today_result.scalar_one_or_none()
        if today_stats:
            today_stats.earning_multiplier = round(today_stats.earning_multiplier + 0.2, 2)
