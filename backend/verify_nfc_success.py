import asyncio
import time
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models.session import NfcSession
from app.config import get_settings
import urllib.request
import json

BASE_URL = "http://api:8000/events"
API_KEY = "9a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p"
DEVICE_ID = "pixel_8a_test"
TAG_ID = "tag_nfc_desk_abc123"

async def create_fake_open_session():
    settings = get_settings()
    # Inside docker compose network, db is at db:5432
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(bind=engine, expire_on_commit=False)
    
    now_ms = int(time.time() * 1000)
    one_hour_ago_ms = now_ms - (60 * 60 * 1000) # 1 hour ago
    
    async with Session() as session:
        # Create NFC session started 1 hour ago
        db_session = NfcSession(
            tag_id=TAG_ID,
            tag_label="Study Desk Tag",
            device_id=DEVICE_ID,
            start_ms=one_hour_ago_ms,
            is_open=True
        )
        session.add(db_session)
        await session.commit()
        print(f"Created fake open NFC session ID: {db_session.id} starting 1 hour ago")
    
    await engine.dispose()

def stop_session_via_api():
    envelope = {
        "device_id": DEVICE_ID,
        "timestamp_ms": int(time.time() * 1000),
        "event_type": "NFC_SESSION_STOP",
        "payload": {
            "tag_id": TAG_ID,
            "tag_label": "Study Desk Tag"
        }
    }
    
    req = urllib.request.Request(
        f"{BASE_URL}/nfc",
        data=json.dumps(envelope).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-API-Key": API_KEY
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            print(f"\nPOST /nfc (Stop) -> Status: {response.status}")
            print(f"Response: {res_body}\n")
    except Exception as e:
        print(f"API request failed: {str(e)}")

async def main():
    print("=== STARTING NFC SESSION COMPLETION TEST ===")
    await create_fake_open_session()
    stop_session_via_api()
    print("=== TEST COMPLETE ===")

if __name__ == "__main__":
    asyncio.run(main())
