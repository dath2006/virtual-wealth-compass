import asyncio
import httpx
from app.config import get_settings

async def main():
    settings = get_settings()
    prompt = "Test greeting"
    
    headers = {
        "Authorization": f"Bearer {settings.nvidia_api_key}",
        "Accept": "application/json"
    }
    payload = {
        "model": settings.nvidia_model,
        "reasoning_effort": "high",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 100,
        "temperature": 0.3,
        "top_p": 1.00,
        "stream": False
    }
    
    print(f"NVIDIA API Key: {settings.nvidia_api_key}")
    print(f"Model: {settings.nvidia_model}")
    
    url = "https://integrate.api.nvidia.com/v1/chat/completions"
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(url, headers=headers, json=payload)
            print(f"Status Code: {resp.status_code}")
            print("Response Headers:")
            print(resp.headers)
            print("Response Body:")
            print(resp.text)
        except Exception as e:
            print(f"Exception: {e}")

if __name__ == "__main__":
    asyncio.run(main())
