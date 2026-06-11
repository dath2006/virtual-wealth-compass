from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.stats import DailyStats
from app.services import economy_service

router = APIRouter(prefix="/stats", dependencies=[Depends(verify_api_key)])

@router.get("/daily")
async def get_daily_stats(limit: int = 365, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DailyStats).order_by(DailyStats.date.desc()).limit(limit)
    )
    stats_list = result.scalars().all()
    
    settings = await economy_service.get_settings(db)
    target_min = int(settings.daily_target_hours * 60)
    threshold = settings.lazy_tax_threshold_pct
    
    response = []
    # To determine mercyUsed, we check if target was not hit and lazy tax was not applied,
    # and compare with yesterday's mercy tokens (or just calculate if completion was below threshold but no tax was charged)
    for s in stats_list:
        mercy_used = False
        completion_ratio = s.minutes_worked / target_min if target_min > 0 else 0
        if completion_ratio < threshold and not s.lazy_tax_applied and not s.target_hit:
            mercy_used = True
            
        response.append({
            "dateISO": s.date.strftime("%Y-%m-%d"),
            "studyMin": s.minutes_worked,
            "targetMin": target_min,
            "hit": s.target_hit,
            "mercyUsed": mercy_used
        })
        
    return response

@router.get("/streak")
async def get_current_streak(db: AsyncSession = Depends(get_db)):
    today_stats = await economy_service.get_or_create_daily_stats(db)
    return {"streak": today_stats.streak_count}
