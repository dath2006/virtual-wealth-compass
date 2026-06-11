from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.oath import Oath, OathStatus
from app.models.ledger import LedgerCategory
from app.services import ledger_service, economy_service
import time

router = APIRouter(prefix="/oaths", dependencies=[Depends(verify_api_key)])

class CreateOathRequest(BaseModel):
    task: str
    loanAmount: int
    dueMs: int

@router.get("")
async def get_oaths(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Oath).order_by(Oath.created_at_ms.desc())
    )
    oaths = result.scalars().all()
    
    stats = await economy_service.get_or_create_daily_stats(db)
    tier_info = await economy_service.credit_score_for_tier(stats.credit_score)
    
    return [
        {
            "id": o.id,
            "task": o.task_description,
            "loanAmount": o.initial_loan_amount,
            "currentDebt": o.current_debt_amount,
            "dailyInterest": o.daily_interest_rate,
            "createdMs": o.created_at_ms,
            "dueMs": o.due_date_ms,
            "status": o.status.value,
            "tier": tier_info["tier"]
        }
        for o in oaths
    ]

@router.post("", status_code=201)
async def create_oath(req: CreateOathRequest, db: AsyncSession = Depends(get_db)):
    now_ms = int(time.time() * 1000)
    if req.dueMs <= now_ms:
        raise HTTPException(status_code=400, detail="Due date must be in the future")
    if req.loanAmount <= 0:
        raise HTTPException(status_code=400, detail="Loan amount must be > 0")

    # Determine interest rate from credit score
    stats = await economy_service.get_or_create_daily_stats(db)
    tier_info = await economy_service.credit_score_for_tier(stats.credit_score)
    interest_rate = tier_info["interest_rate"]

    # Check if they have an interest-free token from beating a boss fight
    # Search for an unused BOSS_REWARD ledger entry for interest-free token
    # For simplicity, we can query if they have a ledger entry with description "Interest-free Oath token..."
    # and mark it as consumed (e.g. rename description or we can just keep it simple)
    result_reward = await db.execute(
        select(Oath).where(
            and_(
                Oath.status == OathStatus.ACTIVE,
                # if there is already an active loan, maybe we allow it, but let's see
            )
        )
    )
    
    # Create the oath
    oath = Oath(
        initial_loan_amount=req.loanAmount,
        current_debt_amount=req.loanAmount,
        task_description=req.task,
        due_date_ms=req.dueMs,
        daily_interest_rate=interest_rate,
        status=OathStatus.ACTIVE
    )
    db.add(oath)
    await db.flush()

    # Credit the loan amount to the ledger
    await ledger_service.insert_entry(
        db=db,
        amount=req.loanAmount,
        category=LedgerCategory.OATH,
        description=f"Oath loan credited: {req.task[:50]}"
    )

    return {
        "id": oath.id,
        "task": oath.task_description,
        "loanAmount": oath.initial_loan_amount,
        "currentDebt": oath.current_debt_amount,
        "dailyInterest": oath.daily_interest_rate,
        "createdMs": oath.created_at_ms,
        "dueMs": oath.due_date_ms,
        "status": oath.status.value,
        "tier": tier_info["tier"]
    }

@router.post("/{oath_id}/repay")
async def repay_oath(oath_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Oath).where(
            and_(
                Oath.id == oath_id,
                Oath.status.in_([OathStatus.ACTIVE, OathStatus.OVERDUE])
            )
        )
    )
    oath = result.scalar_one_or_none()
    if not oath:
        raise HTTPException(status_code=404, detail="Active/overdue oath not found")

    now_ms = int(time.time() * 1000)
    debt_to_pay = oath.current_debt_amount

    # Check if the user has enough balance to repay the oath
    balance = await ledger_service.get_balance(db)
    if balance < debt_to_pay:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance. You need ₹{debt_to_pay} but only have ₹{balance}."
        )

    # 1. Debit the repayment amount from the ledger
    await ledger_service.insert_entry(
        db=db,
        amount=-debt_to_pay,
        category=LedgerCategory.OATH_REPAY,
        description=f"Repaid Oath: {oath.task_description[:50]}"
    )

    # 2. Determine credit score delta and resolution status
    is_on_time = now_ms <= oath.due_date_ms
    
    # Let's check early (e.g. repaid with > 1 day remaining)
    is_early = (oath.due_date_ms - now_ms) > 24 * 60 * 60 * 1000
    
    if is_early:
        oath.status = OathStatus.REPAID_EARLY
        delta = 50
    elif is_on_time:
        oath.status = OathStatus.REPAID_ON_TIME
        delta = 20
    else:
        oath.status = OathStatus.DEFAULTED
        delta = -100

    oath.current_debt_amount = 0
    oath.repaid_at_ms = now_ms
    oath.credit_score_delta = delta

    # 3. Update Credit Score in DailyStats
    stats = await economy_service.get_or_create_daily_stats(db)
    stats.credit_score = max(0, min(900, stats.credit_score + delta))

    return {"status": "ok", "resolved_status": oath.status.value, "credit_score_delta": delta}
