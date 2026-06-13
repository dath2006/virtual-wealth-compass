import asyncio
import base64
import httpx
from io import BytesIO
from app.config import get_settings

try:
    from PIL import Image
    has_pil = True
except ImportError:
    has_pil = False

async def main():
    settings = get_settings()
    
    # Generate a real small 100x100 white image
    if has_pil:
        img = Image.new("RGB", (100, 100), color="white")
        buffered = BytesIO()
        img.save(buffered, format="JPEG")
        image_base64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
    else:
        # Use a fallback base64 for a valid 1x1 white pixel JPEG
        image_base64 = (
            "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////"
            "////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBAB"
            "AAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
        )
        
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
                            "url": f"data:image/jpeg;base64,{image_base64}"
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
    
    url = "https://integrate.api.nvidia.com/v1/chat/completions"
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(url, headers=headers, json=payload)
            print(f"Status Code: {resp.status_code}")
            print("Response body:")
            print(resp.text)
        except Exception as e:
            print(f"Exception: {e}")

if __name__ == "__main__":
    asyncio.run(main())
