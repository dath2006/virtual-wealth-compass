import asyncio
import httpx
from app.config import get_settings

async def main():
    settings = get_settings()
    prompt = """Classify this UPI payment. Respond ONLY with valid JSON, no markdown:
{"class": "ESSENTIAL" or "DISCRETIONARY", "confidence": 0.0-1.0}

Merchant: Zara
Amount: ₹1500
Transaction note: Paid Rs. 1500 to Zara on UPI"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={settings.google_ai_studio_api_key}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                url,
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.1, "maxOutputTokens": 500}
                }
            )
            print(f"Status Code: {response.status_code}")
            print("Response Body:")
            print(response.text)
        except Exception as e:
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
