from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.database import get_db
from app.config import get_settings
import httpx

router = APIRouter(prefix="/health")

@router.get("")
async def health_check(db: AsyncSession = Depends(get_db)):
    db_status = "disconnected"
    try:
        await db.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)}"

    ai_status = "unconfigured"
    settings = get_settings()
    if settings.google_ai_studio_api_key:
        try:
            # Quick check if API key is valid / API is reachable
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={settings.google_ai_studio_api_key}"
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, timeout=3.0)
                if resp.status_code == 200:
                    ai_status = "reachable"
                else:
                    ai_status = f"error: HTTP status {resp.status_code}"
        except Exception as e:
            ai_status = f"error: {str(e)}"

    overall_status = "ok" if db_status == "connected" else "error"

    return {
        "status": overall_status,
        "db": db_status,
        "ai": ai_status
    }
