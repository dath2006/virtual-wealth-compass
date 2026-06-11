from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.session import NfcSession

router = APIRouter(prefix="/sessions", dependencies=[Depends(verify_api_key)])

@router.get("")
async def get_sessions(limit: int = 50, offset: int = 0, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(NfcSession)
        .order_by(NfcSession.start_ms.desc())
        .limit(limit)
        .offset(offset)
    )
    sessions = result.scalars().all()
    return [
        {
            "id": s.id,
            "tagLabel": s.tag_label,
            "startMs": s.start_ms,
            "endMs": s.end_ms,          # null while open — frontend uses null to show live timer
            "isOpen": s.is_open,
            "durationMin": round(s.duration_minutes or 0.0, 1),
            "baseEarned": s.base_earned or 0,
            "multiplier": s.multiplier or 1.0,
            "finalEarned": s.final_earned or 0
        }
        for s in sessions
    ]
