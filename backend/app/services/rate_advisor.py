from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models.ledger import LedgerEntry, LedgerCategory
from app.models.stats import DailyStats
from app.models.rules import DistractionRule
from app.models.suggestion import RateSuggestion
from app.services.ai_service import _call_gemini_text
from app.services.economy_service import get_settings
import json, datetime


async def generate_rate_suggestions(db: AsyncSession) -> list[dict]:
    """
    Analyses last 7 days of economy data and returns rate adjustment suggestions.
    Called weekly by APScheduler on Salary Day.
    Suggestions are stored in rate_suggestions table and served via GET /settings/suggestions.
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


async def _save_suggestions(db: AsyncSession, suggestions: list) -> None:
    """Persist AI suggestions to DB, replacing any existing PENDING ones."""
    # Mark old PENDING suggestions as expired
    old_result = await db.execute(
        select(RateSuggestion).where(RateSuggestion.status == "PENDING")
    )
    for old in old_result.scalars().all():
        old.status = "DISMISSED"  # auto-dismiss stale suggestions

    for s in suggestions:
        try:
            entry = RateSuggestion(
                field=s["field"],
                target_package=s.get("target_package"),
                current_value=int(s["current_value"]),
                suggested_value=int(s["suggested_value"]),
                reason=s["reason"],
                impact=s["impact"],
                status="PENDING",
            )
            db.add(entry)
        except (KeyError, ValueError):
            continue  # skip malformed suggestions

    await db.flush()
