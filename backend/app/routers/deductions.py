from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.deduction import ManualDeduction, DeductionStatus
from app.services import ledger_service, economy_service
from app.services.deduction_service import validate_deduction_with_ai, OVERRIDE_TAX_PCT
from app.models.ledger import LedgerCategory
import time

router = APIRouter(prefix="/deductions", dependencies=[Depends(verify_api_key)])


class DeductionRequest(BaseModel):
    amount:   int
    reason:   str
    category: str = "SELF_PENALTY"


class OverrideRequest(BaseModel):
    deduction_id: int


@router.post("", status_code=201)
async def submit_deduction(req: DeductionRequest, db: AsyncSession = Depends(get_db)):
    """
    Submit a manual self-penalty. AI validates and responds immediately.
    If APPROVED or REDUCED: ledger entry created right away.
    If REJECTED: user can override (with stubbornness tax) or cancel.
    """
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if len(req.reason.strip()) < 20:
        raise HTTPException(
            status_code=400,
            detail="Reason must be at least 20 characters. Be specific."
        )

    settings = await economy_service.get_settings(db)
    verdict  = await validate_deduction_with_ai(
        amount=req.amount,
        reason=req.reason,
        hourly_earn_rate=settings.hourly_earn_rate
    )

    deduction = ManualDeduction(
        amount=req.amount,
        reason=req.reason,
        category=req.category,
        ai_verdict=verdict["verdict"],
        ai_reasoning=verdict["reasoning"],
        ai_suggested_amount=verdict.get("approved_amount", req.amount),
    )
    db.add(deduction)

    if verdict["verdict"] in ("APPROVED", "REDUCED"):
        actual_amount = verdict["approved_amount"]
        entry = await ledger_service.insert_entry(
            db=db,
            amount=-actual_amount,
            category=LedgerCategory.LAZY_TAX,
            description=f"Self-penalty: {req.reason[:100]}",
        )
        deduction.status          = DeductionStatus.APPROVED
        deduction.ledger_entry_id = entry.id
        deduction.resolved_at_ms  = int(time.time() * 1000)

        await db.commit()
        balance = await ledger_service.get_balance(db)
        return {
            "verdict":         verdict["verdict"],
            "amount_deducted": actual_amount,
            "original_amount": req.amount,
            "reasoning":       verdict["reasoning"],
            "new_balance":     balance,
            "deduction_id":    deduction.id,
        }
    else:
        # REJECTED — user can override
        deduction.status = DeductionStatus.PENDING_AI
        await db.commit()
        override_tax = int(req.amount * OVERRIDE_TAX_PCT)
        return {
            "verdict":       "REJECTED",
            "reasoning":     verdict["reasoning"],
            "deduction_id":  deduction.id,
            "can_override":  True,
            "override_cost": req.amount + override_tax,
            "override_tax":  override_tax,
            "message":       "AI rejected this penalty. You can override with a 20% stubbornness tax."
        }


@router.post("/override")
async def override_rejection(req: OverrideRequest, db: AsyncSession = Depends(get_db)):
    """User insists on applying a rejected penalty — pays 20% extra."""
    result    = await db.execute(
        select(ManualDeduction).where(ManualDeduction.id == req.deduction_id)
    )
    deduction = result.scalar_one_or_none()
    if not deduction:
        raise HTTPException(status_code=404, detail="Deduction not found")
    if deduction.status != DeductionStatus.PENDING_AI:
        raise HTTPException(status_code=400, detail="Can only override PENDING deductions")

    override_tax   = int(deduction.amount * OVERRIDE_TAX_PCT)
    total_deducted = deduction.amount + override_tax

    entry = await ledger_service.insert_entry(
        db=db,
        amount=-total_deducted,
        category=LedgerCategory.LAZY_TAX,
        description=f"Self-penalty (override +{int(OVERRIDE_TAX_PCT*100)}% tax): "
                    f"{deduction.reason[:80]}",
    )
    deduction.status            = DeductionStatus.OVERRIDDEN
    deduction.ledger_entry_id   = entry.id
    deduction.override_tax_paid = override_tax
    deduction.resolved_at_ms    = int(time.time() * 1000)

    await db.commit()
    balance = await ledger_service.get_balance(db)
    return {
        "amount_deducted":  total_deducted,
        "stubbornness_tax": override_tax,
        "new_balance":      balance,
    }


@router.get("")
async def list_deductions(db: AsyncSession = Depends(get_db)):
    """Returns recent deduction history."""
    result = await db.execute(
        select(ManualDeduction)
        .order_by(ManualDeduction.submitted_at_ms.desc())
        .limit(50)
    )
    deductions = result.scalars().all()
    return [
        {
            "id":              d.id,
            "amount":          d.amount,
            "reason":          d.reason,
            "category":        d.category,
            "ai_verdict":      d.ai_verdict,
            "ai_reasoning":    d.ai_reasoning,
            "ai_suggested":    d.ai_suggested_amount,
            "status":          d.status.value,
            "submitted_at_ms": d.submitted_at_ms,
        }
        for d in deductions
    ]
