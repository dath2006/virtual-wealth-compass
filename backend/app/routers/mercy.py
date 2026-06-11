from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.services import economy_service

router = APIRouter(prefix="/mercy", dependencies=[Depends(verify_api_key)])

@router.get("")
async def get_mercy_tokens_count(db: AsyncSession = Depends(get_db)):
    stats = await economy_service.get_or_create_daily_stats(db)
    return {"count": stats.mercy_tokens}
