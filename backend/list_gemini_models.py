import asyncio
import httpx
from app.config import get_settings

async def main():
    settings = get_settings()
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={settings.google_ai_studio_api_key}"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url)
            print(f"Status Code: {response.status_code}")
            if response.status_code == 200:
                models = response.json().get("models", [])
                print("Available models:")
                for m in models:
                    print(m.get("name"))
            else:
                print("Error Response:")
                print(response.text)
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
