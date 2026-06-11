from fastapi import Request, HTTPException
from app.config import get_settings

async def verify_api_key(request: Request) -> None:
    """
    FastAPI dependency — attach to any router with:
        router = APIRouter(dependencies=[Depends(verify_api_key)])
    """
    key = request.headers.get("X-API-Key")
    if not key or key != get_settings().api_secret_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
