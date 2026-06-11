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
            "targetHours":  b.target_hours,
            "currentHours": round(b.current_hours, 2),
            "progress_pct":  round((b.current_hours / b.target_hours) * 100, 1)
                             if b.target_hours > 0 else 0,
            "deadlineMs":   b.deadline_ms,
            "days_remaining": max(0, int((b.deadline_ms - now_ms) / 86_400_000)),
            "status":        b.status.value,
            "lootDescription": f"{b.loot_type.value} (+{b.loot_value})" if b.loot_type != LootType.RUPEE_PAYOUT else f"₹{b.loot_value} payout",
            "lootAmount":    b.loot_value,
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
    return {"status": "abandoned"}
