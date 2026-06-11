from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models.ledger import LedgerEntry, LedgerCategory, SpendClass
import time

async def insert_entry(
    db: AsyncSession,
    amount: int,
    category: LedgerCategory,
    description: str,
    merchant_name: str | None = None,
    spend_class: SpendClass | None = None,
    dedup_key: str | None = None,
    device_id: str | None = None,
    is_verified_by_ai: bool = False,
    raw_payload: str | None = None,
) -> LedgerEntry:
    entry = LedgerEntry(
        amount=amount,
        category=category,
        description=description,
        merchant_name=merchant_name,
        spend_class=spend_class,
        dedup_key=dedup_key,
        device_id=device_id,
        is_verified_by_ai=is_verified_by_ai,
        raw_payload=raw_payload,
        timestamp_ms=int(time.time() * 1000),
    )
    db.add(entry)
    await db.flush()   # get the ID without committing
    return entry

async def get_balance(db: AsyncSession) -> int:
    """
    THE canonical balance computation.
    Excludes disputed entries (they are suspended pending resolution).
    Balance CAN be negative — that is the bankrupt state.
    """
    result = await db.execute(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0))
        .where(LedgerEntry.is_disputed == False)
    )
    return result.scalar_one()

async def check_dedup(db: AsyncSession, dedup_key: str) -> bool:
    """Returns True if this dedup_key already exists — skip insertion."""
    result = await db.execute(
        select(LedgerEntry.id).where(LedgerEntry.dedup_key == dedup_key).limit(1)
    )
    return result.scalar_one_or_none() is not None

async def get_entries(
    db: AsyncSession,
    limit: int = 50,
    offset: int = 0,
    category: LedgerCategory | None = None,
    date_from_ms: int | None = None,
    date_to_ms: int | None = None,
) -> list[LedgerEntry]:
    filters = [LedgerEntry.is_disputed == False]
    if category:
        filters.append(LedgerEntry.category == category)
    if date_from_ms:
        filters.append(LedgerEntry.timestamp_ms >= date_from_ms)
    if date_to_ms:
        filters.append(LedgerEntry.timestamp_ms <= date_to_ms)

    result = await db.execute(
        select(LedgerEntry)
        .where(and_(*filters))
        .order_by(LedgerEntry.timestamp_ms.desc())
        .limit(limit)
        .offset(offset)
    )
    return result.scalars().all()
