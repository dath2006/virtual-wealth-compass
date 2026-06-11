from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.models.bossfight import BossFight, BossFightStatus, LootType
from app.models.ledger import LedgerCategory
from app.services import ledger_service
import time
import logging

logger = logging.getLogger("boss_service")

async def progress_boss_fights(
    db: AsyncSession,
    session_minutes: float,
) -> list[dict]:
    """
    Called after every completed NFC session.
    Adds session_minutes to all ACTIVE boss fights.
    If any boss fight reaches target_hours, awards loot immediately.

    Returns a list of completion events so the NFC handler can include
    them in the push notification back to the Android app.

    Example return:
    [{"boss_id": 1, "title": "DBMS End Sem", "loot_type": "RUPEE_PAYOUT", "loot_value": 500}]
    """
    now_ms = int(time.time() * 1000)
    session_hours = session_minutes / 60.0

    # Fetch all active boss fights that haven't passed their deadline
    result = await db.execute(
        select(BossFight).where(
            and_(
                BossFight.status == BossFightStatus.ACTIVE,
                BossFight.deadline_ms > now_ms,
            )
        )
    )
    active_bosses = result.scalars().all()

    completed_bosses = []

    for boss in active_bosses:
        boss.current_hours += session_hours
        logger.info(
            f"Boss '{boss.title}': {boss.current_hours:.2f}/{boss.target_hours}h"
        )

        if boss.current_hours >= boss.target_hours and not boss.loot_awarded:
            # ── Boss beaten — award loot ──────────────────────────────────
            await _award_loot(db, boss, now_ms)
            completed_bosses.append({
                "boss_id":    boss.id,
                "title":      boss.title,
                "loot_type":  boss.loot_type.value,
                "loot_value": boss.loot_value,
            })

    return completed_bosses

async def _award_loot(db: AsyncSession, boss: BossFight, now_ms: int) -> None:
    """
    Awards loot for a completed boss fight. Called exactly once per boss
    (guarded by loot_awarded flag — idempotent even on retry).
    """
    # Double-check idempotency (race condition guard)
    if boss.loot_awarded:
        return

    boss.status       = BossFightStatus.BEATEN
    boss.loot_awarded = True
    boss.beaten_at_ms = now_ms

    if boss.loot_type == LootType.RUPEE_PAYOUT:
        entry = await ledger_service.insert_entry(
            db=db,
            amount=boss.loot_value,
            category=LedgerCategory.BOSS_REWARD,
            description=f"Boss Fight cleared: {boss.title} — ₹{boss.loot_value} loot drop",
        )
        boss.loot_ledger_entry_id = entry.id
        logger.info(f"Boss '{boss.title}' beaten — ₹{boss.loot_value} awarded")

    elif boss.loot_type == LootType.MERCY_TOKEN:
        # Add a mercy token to today's daily stats
        from app.services.economy_service import get_or_create_daily_stats
        stats = await get_or_create_daily_stats(db)
        stats.mercy_tokens = min(stats.mercy_tokens + 1, 3)
        logger.info(f"Boss '{boss.title}' beaten — Mercy Token awarded")

    elif boss.loot_type == LootType.FREE_SCROLL:
        # Insert a special FREE_SCROLL ledger entry with minutes as value
        entry = await ledger_service.insert_entry(
            db=db,
            amount=0,   # no monetary value — it's a time pass
            category=LedgerCategory.BOSS_REWARD,
            description=f"Free Scroll pass: {boss.loot_value}min — Boss: {boss.title}",
        )
        boss.loot_ledger_entry_id = entry.id
        logger.info(f"Boss '{boss.title}' beaten — {boss.loot_value}min free scroll awarded")

    elif boss.loot_type == LootType.INTEREST_FREE:
        # Flag stored as a special ledger entry
        entry = await ledger_service.insert_entry(
            db=db,
            amount=0,
            category=LedgerCategory.BOSS_REWARD,
            description=f"Interest-free Oath token — Boss: {boss.title}",
        )
        boss.loot_ledger_entry_id = entry.id
        logger.info(f"Boss '{boss.title}' beaten — Interest-free Oath token awarded")

async def fail_expired_boss_fights(db: AsyncSession) -> None:
    """
    Called from midnight_audit to mark overdue incomplete boss fights as FAILED.
    No penalty — just a status change so the frontend can show them correctly.
    """
    now_ms = int(time.time() * 1000)
    result = await db.execute(
        select(BossFight).where(
            and_(
                BossFight.status == BossFightStatus.ACTIVE,
                BossFight.deadline_ms <= now_ms,
                BossFight.current_hours < BossFight.target_hours,
            )
        )
    )
    expired = result.scalars().all()
    for boss in expired:
        boss.status       = BossFightStatus.FAILED
        boss.failed_at_ms = now_ms
        logger.info(f"Boss '{boss.title}' expired — marked FAILED")
