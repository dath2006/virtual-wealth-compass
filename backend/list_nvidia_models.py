import asyncio
import httpx
from app.config import get_settings

async def main():
    settings = get_settings()
    headers = {
        "Authorization": f"Bearer {settings.nvidia_api_key}",
        "Accept": "application/json"
    }
    url = "https://integrate.api.nvidia.com/v1/models"
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(url, headers=headers)
            print(f"Status Code: {resp.status_code}")
            if resp.status_code == 200:
                models = resp.json().get("data", [])
                print(f"Found {len(models)} models.")
                # Filter models containing "llama" or "mistral" or "vision"
                for m in models:
                    m_id = m.get("id", "")
                    if "llama-3.2" in m_id or "mistral" in m_id or "vision" in m_id or "nemotron" in m_id:
                        print(f"- {m_id}")
            else:
                print(resp.text)
        except Exception as e:
            print(f"Exception: {e}")

if __name__ == "__main__":
    asyncio.run(main())
