import time
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.oath import Oath, OathStatus
from app.services import economy_service

router = APIRouter(prefix="/credit", dependencies=[Depends(verify_api_key)])

@router.get("")
async def get_credit_score_info(db: AsyncSession = Depends(get_db)):
    stats = await economy_service.get_or_create_daily_stats(db)
    tier_info = await economy_service.credit_score_for_tier(stats.credit_score)
    
    # Query resolved oaths for history
    result = await db.execute(
        select(Oath)
        .where(Oath.status.in_([OathStatus.REPAID_EARLY, OathStatus.REPAID_ON_TIME, OathStatus.DEFAULTED]))
        .order_by(Oath.repaid_at_ms.desc())
        .limit(10)
    )
    resolved_oaths = result.scalars().all()
    
    recent_events = []
    for o in resolved_oaths:
        label = "Repayment"
        if o.status == OathStatus.REPAID_EARLY:
            label = "Early repayment"
        elif o.status == OathStatus.REPAID_ON_TIME:
            label = "On-time repayment"
        elif o.status == OathStatus.DEFAULTED:
            label = "Default"
            
        recent_events.append({
            "label": label,
            "delta": o.credit_score_delta,
            "whenMs": o.repaid_at_ms or o.due_date_ms
        })
        
    # If no events, provide a default starting status
    if not recent_events:
        recent_events.append({
            "label": "Initial score setup",
            "delta": 0,
            "whenMs": int(time.time() * 1000)
        })

    for e in recent_events:
        if not e["whenMs"]:
            e["whenMs"] = int(time.time() * 1000)
            
    return {
        "score": stats.credit_score,
        "tier": tier_info["tier"],
        "recentEvents": recent_events
    }
