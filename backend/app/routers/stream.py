import json
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from app.services.sse_manager import sse_manager
from app.middleware.auth import verify_api_key

router = APIRouter(dependencies=[Depends(verify_api_key)])


@router.get("/stream")
async def event_stream(request: Request):
    """
    Browser connects here once and receives live economy events.
    Events pushed by: /events/usage_session, /events/upi, /events/nfc, heartbeat.

    Event types the browser receives:
    - {"type": "drain",   "app": "Instagram", "amount": -16, "balance": 1224}
    - {"type": "earn",    "source": "NFC",    "amount": 200,  "balance": 1424}
    - {"type": "upi",     "merchant": "Swiggy","amount": -180, "balance": 1244}
    - {"type": "balance", "balance": 1244}   (general refresh)
    - {"type": "pass_expired", "pass_type": "MOVIE"}
    - {"type": "boss_beaten",  "title": "DBMS End Sem", "loot": 500}
    """
    q = sse_manager.subscribe()

    async def generator():
        try:
            # Send current balance immediately on connect
            from app.database import AsyncSessionLocal
            from app.services.ledger_service import get_balance
            async with AsyncSessionLocal() as db:
                balance = await get_balance(db)
            yield f"data: {json.dumps({'type': 'init', 'balance': balance})}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                async for chunk in sse_manager.stream(q):
                    yield chunk
        finally:
            sse_manager.unsubscribe(q)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",   # tell Nginx not to buffer SSE
        }
    )
