from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.device import DeviceHeartbeat

router = APIRouter(prefix="/device", dependencies=[Depends(verify_api_key)])

@router.get("")
async def get_device_info(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DeviceHeartbeat).order_by(DeviceHeartbeat.last_seen_ms.desc()).limit(1)
    )
    heartbeat = result.scalar_one_or_none()
    if not heartbeat:
        return {
            "deviceId": "unknown",
            "lastHeartbeatMs": 0,
            "batteryPct": 100
        }
    return {
        "deviceId": heartbeat.device_id,
        "lastHeartbeatMs": heartbeat.last_seen_ms,
        "batteryPct": heartbeat.battery_pct
    }
