import asyncio
import httpx
from app.config import get_settings
from app.services.ai_service import _call_ai_vision

async def test_vision():
    settings = get_settings()
    dummy_image_base64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
    prompt = "Describe what is in this image."
    
    headers = {
        "Authorization": f"Bearer {settings.nvidia_api_key}",
        "Accept": "application/json"
    }
    payload = {
        "model": "meta/llama-3.2-11b-vision-instruct",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{dummy_image_base64}"
                        }
                    }
                ]
            }
        ],
        "max_tokens": 100,
        "temperature": 0.1,
        "top_p": 1.00,
        "stream": False
    }
    
    print(f"Model: {settings.nvidia_vision_model}")
    url = "https://integrate.api.nvidia.com/v1/chat/completions"
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(url, headers=headers, json=payload)
            print(f"Status Code: {resp.status_code}")
            print("Response body:")
            print(resp.text)
        except Exception as e:
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_vision())
