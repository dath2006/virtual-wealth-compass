# Backend Spec — Addendum: Boss Fight System

Addendum to `BACKEND_SPEC.md`. Slot this into the main spec as:
- Section 7d: `app/models/bossfight.py`
- Section 12b: Boss Fight logic inside the existing `/events/nfc` handler
- Section 15b: New `/bosses` router

---

## Model: `app/models/bossfight.py`

```python
import enum
from sqlalchemy import BigInteger, Integer, Float, String, Boolean, Enum
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time

class LootType(str, enum.Enum):
    RUPEE_PAYOUT    = "RUPEE_PAYOUT"     # flat ₹ credited to ledger
    MERCY_TOKEN     = "MERCY_TOKEN"      # +1 mercy token
    FREE_SCROLL     = "FREE_SCROLL"      # X minutes of zero-cost distraction
    INTEREST_FREE   = "INTEREST_FREE"    # next Oath has 0% interest

class BossFightStatus(str, enum.Enum):
    ACTIVE    = "ACTIVE"      # deadline not passed, hours not complete
    BEATEN    = "BEATEN"      # current_hours >= target_hours before deadline
    FAILED    = "FAILED"      # deadline passed without completion
    ABANDONED = "ABANDONED"   # manually cancelled

class BossFight(Base):
    __tablename__ = "boss_fights"

    id:             Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title:          Mapped[str]   = mapped_column(String(200), nullable=False)
    # e.g. "DBMS End Sem", "DAA Project Submission"

    target_hours:   Mapped[float] = mapped_column(Float, nullable=False)
    # total focus hours required to beat this boss

    current_hours:  Mapped[float] = mapped_column(Float, default=0.0)
    # accumulated via NFC sessions — never manually edited

    deadline_ms:    Mapped[int]   = mapped_column(BigInteger, nullable=False)
    # unix ms timestamp of the deadline

    status:         Mapped[BossFightStatus] = mapped_column(
                        Enum(BossFightStatus), default=BossFightStatus.ACTIVE)

    loot_type:      Mapped[LootType] = mapped_column(
                        Enum(LootType), default=LootType.RUPEE_PAYOUT)

    loot_value:     Mapped[int]   = mapped_column(Integer, default=500)
    # For RUPEE_PAYOUT: ₹ amount. For FREE_SCROLL: minutes. For others: 1 = granted.

    loot_awarded:   Mapped[bool]  = mapped_column(Boolean, default=False)
    # Idempotency flag — loot is awarded exactly once, even if NFC retries fire.

    loot_ledger_entry_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    # Points to the LedgerEntry that was created when loot was awarded.

    created_at_ms:  Mapped[int]   = mapped_column(BigInteger,
                        default=lambda: int(time.time() * 1000))
    beaten_at_ms:   Mapped[int]   = mapped_column(BigInteger, nullable=True)
    failed_at_ms:   Mapped[int]   = mapped_column(BigInteger, nullable=True)
```

---

## Boss Fight Service: `app/services/boss_service.py`

This service is called from inside the NFC stop-session handler — after a session is
recorded and `final_earned` is computed, `progress_boss_fights()` is called with the
session duration. It handles progression, completion detection, and loot award atomically
in the same DB transaction as the session itself.

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.models.bossfight import BossFight, BossFightStatus, LootType
from app.models.stats import DailyStats
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
        # The Android heartbeat response will include a free_scroll_minutes field
        # which the lockout system checks before applying distraction drain
        entry = await ledger_service.insert_entry(
            db=db,
            amount=0,   # no monetary value — it's a time pass
            category=LedgerCategory.BOSS_REWARD,
            description=f"Free Scroll pass: {boss.loot_value}min — Boss: {boss.title}",
        )
        boss.loot_ledger_entry_id = entry.id
        logger.info(f"Boss '{boss.title}' beaten — {boss.loot_value}min free scroll awarded")

    elif boss.loot_type == LootType.INTEREST_FREE:
        # Flag stored as a special ledger entry — oath_service reads this
        # when creating a new oath to check if interest-free is available
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
```

---

## Updated NFC Handler — add boss progression after session stop

In `app/routers/events.py`, inside the `receive_nfc_tap` handler, after the line
`open_session.ledger_entry_id = entry.id`, add:

```python
# ── Progress active boss fights with this session's duration ──────────────
from app.services.boss_service import progress_boss_fights

beaten_bosses = await progress_boss_fights(
    db=db,
    session_minutes=minutes,
)

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
    "beaten_bosses": beaten_bosses,   # ← new field for Android to show special UI
    "notification": {
        "title": f"✅ Session complete! Earned ₹{final}",
        "body": base_notif_body,
        "priority": "high" if beaten_bosses else "default"
    }
}
```

---

## New Router: `app/routers/bosses.py`

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.bossfight import BossFight, BossFightStatus, LootType
import time

router = APIRouter(prefix="/bosses", dependencies=[Depends(verify_api_key)])


class CreateBossFightRequest(BaseModel):
    title:        str
    target_hours: float
    deadline_ms:  int
    loot_type:    LootType = LootType.RUPEE_PAYOUT
    loot_value:   int = 500


# GET /bosses — all boss fights (active + historical)
@router.get("")
async def get_boss_fights(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BossFight).order_by(BossFight.deadline_ms.asc())
    )
    bosses = result.scalars().all()

    now_ms = int(time.time() * 1000)
    return [
        {
            "id":            b.id,
            "title":         b.title,
            "target_hours":  b.target_hours,
            "current_hours": round(b.current_hours, 2),
            "progress_pct":  round((b.current_hours / b.target_hours) * 100, 1)
                             if b.target_hours > 0 else 0,
            "deadline_ms":   b.deadline_ms,
            "days_remaining": max(0, int((b.deadline_ms - now_ms) / 86_400_000)),
            "status":        b.status.value,
            "loot_type":     b.loot_type.value,
            "loot_value":    b.loot_value,
            "loot_awarded":  b.loot_awarded,
            "beaten_at_ms":  b.beaten_at_ms,
            "failed_at_ms":  b.failed_at_ms,
        }
        for b in bosses
    ]


# POST /bosses — create a new boss fight
@router.post("", status_code=201)
async def create_boss_fight(
    req: CreateBossFightRequest,
    db: AsyncSession = Depends(get_db),
):
    now_ms = int(time.time() * 1000)
    if req.deadline_ms <= now_ms:
        raise HTTPException(status_code=400, detail="Deadline must be in the future")
    if req.target_hours <= 0:
        raise HTTPException(status_code=400, detail="target_hours must be > 0")

    boss = BossFight(
        title=req.title,
        target_hours=req.target_hours,
        deadline_ms=req.deadline_ms,
        loot_type=req.loot_type,
        loot_value=req.loot_value,
    )
    db.add(boss)
    await db.flush()
    await db.commit()
    return {"id": boss.id, "title": boss.title, "status": "created"}


# DELETE /bosses/{id} — abandon a boss fight
@router.delete("/{boss_id}")
async def abandon_boss_fight(boss_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BossFight).where(
            and_(BossFight.id == boss_id, BossFight.status == BossFightStatus.ACTIVE)
        )
    )
    boss = result.scalar_one_or_none()
    if not boss:
        raise HTTPException(status_code=404, detail="Active boss fight not found")

    boss.status = BossFightStatus.ABANDONED
    await db.commit()
    return {"status": "abandoned"}
```

---

## Wire up in `app/main.py`

Add alongside the other router imports:

```python
from app.routers import bosses
app.include_router(bosses.router)
```

And add the midnight failure check inside `_audit()` in `audit_service.py`,
at the end of the function:

```python
# ── 6. Fail expired boss fights ───────────────────────────────────────────
from app.services.boss_service import fail_expired_boss_fights
await fail_expired_boss_fights(db)
```

---

## Summary of design decisions

**Auto-progression:** Every completed NFC session calls `progress_boss_fights()` in
the same DB transaction. This means hours accumulate in real time — the frontend
`/bosses` response always shows the live `current_hours` and `progress_pct`.

**Auto-award:** Loot fires the moment `current_hours >= target_hours` is detected,
inside the same NFC stop-session transaction. The `loot_awarded` boolean is the
idempotency guard — if the same session somehow triggers twice (network retry),
the second call hits the `if boss.loot_awarded: return` check and exits cleanly.
The `UNIQUE` constraint on `dedup_key` in `ledger_entries` is a second layer of
defence for `RUPEE_PAYOUT` loot if the same ledger entry somehow fires twice.

**Failure detection:** Expired boss fights are marked `FAILED` by the midnight audit,
not in real time. This is intentional — there's no value in checking every heartbeat.
The frontend should derive "is this boss overdue?" from `deadline_ms < now` client-side
for display purposes, but the canonical `status = FAILED` is set at midnight.
