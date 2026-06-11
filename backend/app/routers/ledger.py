from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.services import ledger_service
from app.models.ledger import LedgerCategory

router = APIRouter(dependencies=[Depends(verify_api_key)])

@router.get("/ledger")
async def get_ledger_entries(
    limit: int = 100,
    offset: int = 0,
    category: str | None = None,
    db: AsyncSession = Depends(get_db)
):
    ledger_category = None
    if category:
        try:
            ledger_category = LedgerCategory(category)
        except ValueError:
            pass

    entries = await ledger_service.get_entries(
        db=db,
        limit=limit,
        offset=offset,
        category=ledger_category
    )

    return [
        {
            "id": e.id,
            "amount": e.amount,
            "category": e.category.value,
            "description": e.description,
            "merchantName": e.merchant_name,
            "spendClass": e.spend_class.value if e.spend_class else None,
            "status": "DISPUTED" if e.is_disputed else "VERIFIED",
            "timestampMs": e.timestamp_ms
        }
        for e in entries
    ]

@router.get("/balance")
async def get_wallet_balance(db: AsyncSession = Depends(get_db)):
    balance = await ledger_service.get_balance(db)
    return {"balance": balance}
