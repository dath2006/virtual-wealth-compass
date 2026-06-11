from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, update
from pydantic import BaseModel
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.marketplace import MarketplacePass, PurchasedPass, PassStatus, PassType, PassCategory
from app.models.oath import Oath, OathStatus
from app.models.stats import DailyStats
from app.services import ledger_service, economy_service
from app.models.ledger import LedgerCategory, LedgerEntry
import time, datetime

router = APIRouter(prefix="/marketplace", dependencies=[Depends(verify_api_key)])

MONTHLY_MARKETPLACE_SPEND_CAP = 1500  # ₹ virtual per month

CATALOGUE_SEED = [
    {
        "pass_type": PassType.MOVIE,
        "display_name": "Movie Night 🎬",
        "description": "3 hours of zero-drain entertainment. Watch anything guilt-free.",
        "category": PassCategory.TIME,
        "virtual_price": 300,
        "duration_minutes": 180,
        "min_work_hours_today": 2.0,
        "min_balance_after_purchase": 100,
        "weekly_purchase_limit": 2,
        "valid_after_hour": 18,      # only after 6 PM on weekdays
        "blocked_during_study_hours": True,
        "cooldown_hours_after_use": 20,
        "guilt_tax_pct": 0.20,
    },
    {
        "pass_type": PassType.GAMING,
        "display_name": "Gaming Session 🎮",
        "description": "90 minutes on gaming apps. No drain, no guilt.",
        "category": PassCategory.TIME,
        "virtual_price": 150,
        "duration_minutes": 90,
        "min_work_hours_today": 1.5,
        "min_balance_after_purchase": 50,
        "weekly_purchase_limit": 3,
        "valid_after_hour": 17,
        "blocked_during_study_hours": True,
        "cooldown_hours_after_use": 8,
    },
    {
        "pass_type": PassType.BINGE,
        "display_name": "Binge Pass 📺",
        "description": "2 hours of streaming. Netflix, YouTube, Prime — all free.",
        "category": PassCategory.TIME,
        "virtual_price": 200,
        "duration_minutes": 120,
        "min_work_hours_today": 1.5,
        "min_balance_after_purchase": 50,
        "weekly_purchase_limit": 3,
        "blocked_during_study_hours": True,
        "cooldown_hours_after_use": 10,
    },
    {
        "pass_type": PassType.NAP,
        "display_name": "Guilt-Free Nap 😴",
        "description": "45 min rest. All drain suspended. You earned it.",
        "category": PassCategory.COOLDOWN,
        "virtual_price": 50,
        "duration_minutes": 45,
        "min_work_hours_today": 1.0,
        "weekly_purchase_limit": 2,
        "blocked_during_study_hours": False,  # naps are always ok
        "cooldown_hours_after_use": 6,
    },
    {
        "pass_type": PassType.STUDY_BREAK,
        "display_name": "Study Break ☕",
        "description": "Free 20-min break after a solid session. No conditions once unlocked.",
        "category": PassCategory.COOLDOWN,
        "virtual_price": 0,           # free!
        "duration_minutes": 20,
        "min_work_hours_today": 0.75, # requires 45-min session first
        "weekly_purchase_limit": 5,
        "blocked_during_study_hours": False,
        "cooldown_hours_after_use": 2,
    },
    {
        "pass_type": PassType.RESTAURANT,
        "display_name": "Eat Out Pass 🍽",
        "description": "Next restaurant UPI up to ₹800 costs zero virtual ₹.",
        "category": PassCategory.ACTIVITY,
        "virtual_price": 250,
        "duration_minutes": None,     # consumed by event
        "min_work_hours_today": 1.0,
        "min_balance_after_purchase": 100,
        "weekly_purchase_limit": 2,
        "blocked_during_study_hours": False,
        "cooldown_hours_after_use": 0,
    },
    {
        "pass_type": PassType.WEEKEND_OUTING,
        "display_name": "Weekend Outing 🚶",
        "description": "All UPI debits under ₹2000 today are penalty-free.",
        "category": PassCategory.ACTIVITY,
        "virtual_price": 400,
        "duration_minutes": None,
        "min_balance_after_purchase": 200,
        "requires_no_overdue_oaths": True,
        "weekly_purchase_limit": 1,
        "valid_on_weekends_only": True,
        "blocked_during_study_hours": False,
        "cooldown_hours_after_use": 0,
    },
    {
        "pass_type": PassType.BOOK_PURCHASE,
        "display_name": "Book Fund 📚",
        "description": "Next Amazon/Flipkart purchase under ₹500 = zero virtual cost.",
        "category": PassCategory.ACTIVITY,
        "virtual_price": 30,
        "duration_minutes": None,
        "weekly_purchase_limit": 4,   # books are encouraged
        "blocked_during_study_hours": False,
    },
    {
        "pass_type": PassType.WEEKEND_MODE,
        "display_name": "Weekend Mode 🌅",
        "description": "Sat + Sun at half drain rate. Requires 5-day streak to unlock.",
        "category": PassCategory.COOLDOWN,
        "virtual_price": 500,
        "duration_minutes": 2880,     # 48 hours
        "min_streak_to_unlock": 5,
        "min_balance_after_purchase": 300,
        "valid_on_weekends_only": True,
        "weekly_purchase_limit": 1,
        "blocked_during_study_hours": False,
    },
    {
        "pass_type": PassType.VACATION_MODE,
        "display_name": "Vacation Mode ✈",
        "description": "5 days of fully suspended economy. For actual trips only.",
        "category": PassCategory.COOLDOWN,
        "virtual_price": 2000,
        "duration_minutes": 7200,     # 5 days
        "min_streak_to_unlock": 7,
        "min_balance_after_purchase": 500,
        "requires_no_overdue_oaths": True,
        "weekly_purchase_limit": 0,   # unlimited
        "monthly_spend_cap_shared": True,
        "blocked_during_study_hours": False,
        "cooldown_hours_after_use": 0,
    },
]

async def seed_marketplace(db: AsyncSession):
    for p_data in CATALOGUE_SEED:
        result = await db.execute(
            select(MarketplacePass).where(MarketplacePass.pass_type == p_data["pass_type"])
        )
        existing = result.scalar_one_or_none()
        if not existing:
            p = MarketplacePass(**p_data)
            db.add(p)
    await db.flush()

# ── GET /marketplace/catalogue ────────────────────────────────────────────────
@router.get("/catalogue")
async def get_catalogue(db: AsyncSession = Depends(get_db)):
    passes_result  = await db.execute(select(MarketplacePass))
    catalogue      = passes_result.scalars().all()
    today_stats    = await economy_service.get_or_create_daily_stats(db)
    settings       = await economy_service.get_settings(db)
    balance        = await ledger_service.get_balance(db)
    now            = datetime.datetime.now()
    now_ms         = int(time.time() * 1000)

    # Check overdue oaths once
    overdue_result = await db.execute(
        select(func.count()).select_from(Oath).where(
            and_(
                Oath.status == OathStatus.ACTIVE,
                Oath.due_date_ms < now_ms
            )
        )
    )
    has_overdue_oaths = overdue_result.scalar_one() > 0

    # Monthly marketplace spend
    month_start = int(datetime.datetime(now.year, now.month, 1).timestamp() * 1000)
    monthly_spent_result = await db.execute(
        select(func.coalesce(func.sum(PurchasedPass.virtual_price_paid + PurchasedPass.guilt_tax_paid), 0))
        .where(
            and_(
                PurchasedPass.purchased_at_ms >= month_start,
                PurchasedPass.status != PassStatus.CANCELLED,
                PurchasedPass.pass_type.in_(
                    [p.pass_type for p in catalogue if p.monthly_spend_cap_shared]
                )
            )
        )
    )
    monthly_marketplace_spent = monthly_spent_result.scalar_one()

    response = []
    for p in catalogue:
        eligibility = await _check_purchase_eligibility(
            db=db, pass_def=p, balance=balance,
            today_stats=today_stats, settings=settings,
            has_overdue_oaths=has_overdue_oaths,
            monthly_marketplace_spent=monthly_marketplace_spent,
            now=now, now_ms=now_ms
        )
        guilt_tax_amount = await _compute_guilt_tax(db, p, now_ms)

        response.append({
            "pass_type":          p.pass_type.value,
            "display_name":       p.display_name,
            "description":        p.description,
            "category":           p.category.value,
            "virtual_price":      p.virtual_price,
            "duration_minutes":   p.duration_minutes,
            "can_purchase":       eligibility["can_purchase"],
            "blocked_reason":     eligibility["reason"],
            "guilt_tax_amount":   guilt_tax_amount,
            "total_price":        p.virtual_price + guilt_tax_amount,
            "weekly_used":        eligibility["weekly_used"],
            "weekly_limit":       p.weekly_purchase_limit,
            "locked_until_streak": p.min_streak_to_unlock,
            "valid_after_hour":   p.valid_after_hour,
            "blocked_during_study_hours": p.blocked_during_study_hours,
        })

    return {
        "passes": response,
        "monthly_marketplace_spent": monthly_marketplace_spent,
        "monthly_marketplace_cap":   MONTHLY_MARKETPLACE_SPEND_CAP,
        "current_balance":           balance,
    }


# ── POST /marketplace/purchase ────────────────────────────────────────────────
class PurchaseRequest(BaseModel):
    pass_type: PassType
    notes: str | None = None

@router.post("/purchase", status_code=201)
async def purchase_pass(req: PurchaseRequest, db: AsyncSession = Depends(get_db)):
    now     = datetime.datetime.now()
    now_ms  = int(time.time() * 1000)
    balance = await ledger_service.get_balance(db)
    today_stats = await economy_service.get_or_create_daily_stats(db)
    settings    = await economy_service.get_settings(db)

    # Load pass definition
    result   = await db.execute(
        select(MarketplacePass).where(MarketplacePass.pass_type == req.pass_type)
    )
    pass_def = result.scalar_one_or_none()
    if not pass_def:
        raise HTTPException(status_code=404, detail="Pass type not found")

    # Check overdue oaths
    overdue_count_result = await db.execute(
        select(func.count()).select_from(Oath).where(
            and_(Oath.status == OathStatus.ACTIVE, Oath.due_date_ms < now_ms)
        )
    )
    has_overdue_oaths = overdue_count_result.scalar_one() > 0

    # Calculate monthly spent for cap check
    month_start = int(datetime.datetime(now.year, now.month, 1).timestamp() * 1000)
    monthly_spent_result = await db.execute(
        select(func.coalesce(func.sum(PurchasedPass.virtual_price_paid + PurchasedPass.guilt_tax_paid), 0))
        .where(
            and_(
                PurchasedPass.purchased_at_ms >= month_start,
                PurchasedPass.status != PassStatus.CANCELLED,
                PurchasedPass.pass_type != req.pass_type # Recalculated for total Catalogue context
            )
        )
    )
    monthly_marketplace_spent = monthly_spent_result.scalar_one()

    # Run eligibility check
    eligibility = await _check_purchase_eligibility(
        db=db, pass_def=pass_def, balance=balance,
        today_stats=today_stats, settings=settings,
        has_overdue_oaths=has_overdue_oaths,
        monthly_marketplace_spent=monthly_marketplace_spent,
        now=now, now_ms=now_ms
    )
    if not eligibility["can_purchase"]:
        raise HTTPException(status_code=400, detail=eligibility["reason"])

    # Compute guilt tax
    guilt_tax = await _compute_guilt_tax(db, pass_def, now_ms)
    total_cost = pass_def.virtual_price + guilt_tax

    # Final balance check after deduction
    if balance - total_cost < pass_def.min_balance_after_purchase:
        raise HTTPException(
            status_code=400,
            detail=f"Purchase would leave balance below ₹{pass_def.min_balance_after_purchase} minimum"
        )

    # Insert ledger debit
    desc = f"Marketplace: {pass_def.display_name}"
    if guilt_tax > 0:
        desc += f" (+ ₹{guilt_tax} guilt tax)"

    entry = await ledger_service.insert_entry(
        db=db,
        amount=-total_cost,
        category=LedgerCategory.MERCY_SPEND,
        description=desc,
    )

    # Create purchased pass record
    purchased = PurchasedPass(
        pass_type=req.pass_type,
        status=PassStatus.PURCHASED,
        category=pass_def.category,
        virtual_price_paid=pass_def.virtual_price,
        guilt_tax_paid=guilt_tax,
        ledger_entry_id=entry.id,
        notes=req.notes,
    )
    db.add(purchased)
    await db.flush()
    await db.commit()

    return {
        "id":           purchased.id,
        "pass_type":    purchased.pass_type.value,
        "status":       "PURCHASED",
        "price_paid":   total_cost,
        "guilt_tax":    guilt_tax,
        "message":      f"Pass purchased. Tap 'Start' when you're ready to begin.",
        "new_balance":  balance - total_cost,
    }


# ── POST /marketplace/activate/{pass_id} ──────────────────────────────────────
@router.post("/activate/{pass_id}")
async def activate_pass(pass_id: int, db: AsyncSession = Depends(get_db)):
    now    = datetime.datetime.now()
    now_ms = int(time.time() * 1000)

    result    = await db.execute(
        select(PurchasedPass).where(PurchasedPass.id == pass_id)
    )
    purchased = result.scalar_one_or_none()
    if not purchased:
        raise HTTPException(status_code=404, detail="Pass not found")
    if purchased.status != PassStatus.PURCHASED:
        raise HTTPException(
            status_code=400,
            detail=f"Pass is already {purchased.status.value} — cannot activate"
        )

    # Load pass definition
    pass_result = await db.execute(
        select(MarketplacePass).where(MarketplacePass.pass_type == purchased.pass_type)
    )
    pass_def = pass_result.scalar_one()

    # Time-of-day restriction
    current_hour = now.hour
    if pass_def.valid_after_hour > 0 and current_hour < pass_def.valid_after_hour:
        raise HTTPException(
            status_code=400,
            detail=f"This pass can only be started after {pass_def.valid_after_hour}:00. It's currently {current_hour}:00."
        )
    if current_hour >= pass_def.valid_before_hour:
        raise HTTPException(
            status_code=400,
            detail=f"This pass must be started before {pass_def.valid_before_hour}:00."
        )

    # Weekend-only restriction
    if pass_def.valid_on_weekends_only and now.weekday() < 5:
        raise HTTPException(
            status_code=400,
            detail="This pass can only be activated on weekends."
        )

    # Study hours restriction
    settings = await economy_service.get_settings(db)
    if pass_def.blocked_during_study_hours:
        if settings.study_hours_start <= current_hour < settings.study_hours_end:
            raise HTTPException(
                status_code=400,
                detail=f"This pass cannot be started during study hours ({settings.study_hours_start}:00–{settings.study_hours_end}:00)."
            )

    # Check for loot bonus
    loot_bonus = await _claim_loot_bonus_minutes(db, purchased.pass_type)

    # Activate
    duration_ms = None
    if pass_def.duration_minutes:
        total_minutes  = pass_def.duration_minutes + loot_bonus
        duration_ms    = total_minutes * 60 * 1000
        expires_at_ms  = now_ms + duration_ms
    else:
        expires_at_ms  = None

    purchased.status          = PassStatus.ACTIVE
    purchased.activated_at_ms = now_ms
    purchased.expires_at_ms   = expires_at_ms
    purchased.loot_bonus_minutes = loot_bonus

    await db.commit()

    return {
        "id":               purchased.id,
        "pass_type":        purchased.pass_type.value,
        "status":           "ACTIVE",
        "activated_at_ms":  now_ms,
        "expires_at_ms":    expires_at_ms,
        "duration_minutes": (pass_def.duration_minutes or 0) + loot_bonus,
        "loot_bonus_minutes": loot_bonus,
        "message":          f"Pass active! Enjoy your {pass_def.display_name}.",
    }


# ── PATCH /marketplace/end-early/{pass_id} ────────────────────────────────────
@router.patch("/end-early/{pass_id}")
async def end_pass_early(pass_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PurchasedPass).where(PurchasedPass.id == pass_id)
    )
    purchased = result.scalar_one_or_none()
    if not purchased:
        raise HTTPException(status_code=404, detail="Pass not found")
    if purchased.status != PassStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Only ACTIVE passes can be ended early")

    purchased.status = PassStatus.EXPIRED
    purchased.expires_at_ms = int(time.time() * 1000)
    await db.commit()
    return {"status": "ok", "message": "Pass ended early."}


# ── GET /marketplace/my-passes ────────────────────────────────────────────────
@router.get("/my-passes")
async def get_my_passes(db: AsyncSession = Depends(get_db)):
    now_ms = int(time.time() * 1000)
    await _auto_expire_passes(db, now_ms)

    result = await db.execute(
        select(PurchasedPass)
        .order_by(PurchasedPass.purchased_at_ms.desc())
        .limit(50)
    )
    passes = result.scalars().all()

    return [
        {
            "id":               p.id,
            "pass_type":        p.pass_type.value,
            "status":           p.status.value,
            "category":         p.category.value,
            "price_paid":       p.virtual_price_paid + p.guilt_tax_paid,
            "purchased_at_ms":  p.purchased_at_ms,
            "activated_at_ms":  p.activated_at_ms,
            "expires_at_ms":    p.expires_at_ms,
            "ms_remaining":     max(0, (p.expires_at_ms or 0) - now_ms)
                                if p.status == PassStatus.ACTIVE and p.expires_at_ms else None,
            "notes":            p.notes,
            "loot_bonus_minutes": p.loot_bonus_minutes,
        }
        for p in passes
    ]


# ── DELETE /marketplace/cancel/{pass_id} ──────────────────────────────────────
@router.delete("/cancel/{pass_id}")
async def cancel_pass(pass_id: int, db: AsyncSession = Depends(get_db)):
    result    = await db.execute(select(PurchasedPass).where(PurchasedPass.id == pass_id))
    purchased = result.scalar_one_or_none()
    if not purchased:
        raise HTTPException(status_code=404, detail="Pass not found")
    if purchased.status != PassStatus.PURCHASED:
        raise HTTPException(status_code=400, detail="Only PURCHASED passes can be cancelled")

    purchased.status = PassStatus.CANCELLED
    await db.commit()
    return {"status": "cancelled", "message": "Pass cancelled. No refund issued."}


# ── Active pass state for heartbeat ──────────────────────────────────────────
async def get_active_pass_for_heartbeat(db: AsyncSession) -> dict | None:
    now_ms = int(time.time() * 1000)
    await _auto_expire_passes(db, now_ms)

    result = await db.execute(
        select(PurchasedPass).where(
            and_(
                PurchasedPass.status == PassStatus.ACTIVE,
            )
        ).limit(1)
    )
    active = result.scalar_one_or_none()
    if not active:
        return None

    return {
        "pass_id":        active.id,
        "pass_type":      active.pass_type.value,
        "category":       active.category.value,
        "expires_at_ms":  active.expires_at_ms,
        "ms_remaining":   max(0, (active.expires_at_ms or 0) - now_ms)
                          if active.expires_at_ms else None,
    }


# ── UPI Activity Pass consumption ────────────────────────────────────────────
async def try_consume_activity_pass(
    db: AsyncSession,
    merchant_name: str | None,
    amount: int,
    dedup_key: str,
) -> bool:
    now_ms = int(time.time() * 1000)

    result = await db.execute(
        select(PurchasedPass).where(
            and_(
                PurchasedPass.status == PassStatus.ACTIVE,
                PurchasedPass.category == PassCategory.ACTIVITY,
            )
        )
    )
    active_activity_passes = result.scalars().all()

    for pass_ in active_activity_passes:
        if _pass_covers_transaction(pass_.pass_type, merchant_name, amount):
            pass_.status              = PassStatus.CONSUMED
            pass_.consumed_at_ms      = now_ms
            pass_.matched_upi_dedup_key = dedup_key
            await db.flush()
            return True

    return False


def _pass_covers_transaction(pass_type: PassType, merchant: str | None, amount: int) -> bool:
    merchant_lower = (merchant or "").lower()
    if pass_type == PassType.RESTAURANT:
        restaurant_keywords = ["restaurant", "cafe", "dhaba", "hotel", "kitchen",
                                "biryani", "pizza", "burger", "dosa", "mess", "canteen"]
        return amount <= 800 and any(k in merchant_lower for k in restaurant_keywords)
    elif pass_type == PassType.WEEKEND_OUTING:
        return amount <= 2000
    elif pass_type == PassType.BOOK_PURCHASE:
        book_merchants = ["amazon", "flipkart", "crossword", "kindle", "notion press"]
        return amount <= 500 and any(k in merchant_lower for k in book_merchants)
    return False


# ── Internal helpers ──────────────────────────────────────────────────────────
async def _check_purchase_eligibility(
    db, pass_def, balance, today_stats, settings,
    has_overdue_oaths, monthly_marketplace_spent, now, now_ms
) -> dict:
    if pass_def.min_streak_to_unlock > 0:
        if today_stats.streak_count < pass_def.min_streak_to_unlock:
            return {"can_purchase": False, "weekly_used": 0,
                    "reason": f"Locked — requires {pass_def.min_streak_to_unlock}-day streak (you have {today_stats.streak_count})"}

    if pass_def.requires_no_overdue_oaths and has_overdue_oaths:
        return {"can_purchase": False, "weekly_used": 0,
                "reason": "Cannot purchase while you have overdue Oaths"}

    hours_today = today_stats.minutes_worked / 60.0
    if hours_today < pass_def.min_work_hours_today:
        needed = pass_def.min_work_hours_today - hours_today
        return {"can_purchase": False, "weekly_used": 0,
                "reason": f"Need {needed:.1f} more study hours today first"}

    week_start = now_ms - (7 * 24 * 60 * 60 * 1000)
    weekly_used_result = await db.execute(
        select(func.count()).select_from(PurchasedPass).where(
            and_(
                PurchasedPass.pass_type == pass_def.pass_type,
                PurchasedPass.purchased_at_ms >= week_start,
                PurchasedPass.status != PassStatus.CANCELLED,
            )
        )
    )
    weekly_used = weekly_used_result.scalar_one()
    if pass_def.weekly_purchase_limit > 0 and weekly_used >= pass_def.weekly_purchase_limit:
        return {"can_purchase": False, "weekly_used": weekly_used,
                "reason": f"Weekly limit reached ({pass_def.weekly_purchase_limit}/week)"}

    if pass_def.monthly_spend_cap_shared:
        if monthly_marketplace_spent + pass_def.virtual_price > MONTHLY_MARKETPLACE_SPEND_CAP:
            remaining = MONTHLY_MARKETPLACE_SPEND_CAP - monthly_marketplace_spent
            return {"can_purchase": False, "weekly_used": weekly_used,
                    "reason": f"Monthly marketplace cap reached (₹{remaining} remaining)"}

    if pass_def.cooldown_hours_after_use > 0:
        cooldown_start = now_ms - (pass_def.cooldown_hours_after_use * 3600 * 1000)
        last_use_result = await db.execute(
            select(PurchasedPass).where(
                and_(
                    PurchasedPass.pass_type == pass_def.pass_type,
                    PurchasedPass.purchased_at_ms >= cooldown_start,
                    PurchasedPass.status.in_([
                        PassStatus.ACTIVE, PassStatus.EXPIRED, PassStatus.CONSUMED
                    ]),
                )
            ).limit(1)
        )
        if last_use_result.scalar_one_or_none():
            return {"can_purchase": False, "weekly_used": weekly_used,
                    "reason": f"Cooldown active — wait {pass_def.cooldown_hours_after_use}h between passes"}

    return {"can_purchase": True, "reason": None, "weekly_used": weekly_used}


async def _compute_guilt_tax(db: AsyncSession, pass_def: MarketplacePass, now_ms: int) -> int:
    if pass_def.guilt_tax_pct <= 0 or pass_def.category != PassCategory.TIME:
        return 0

    today_start_ms = now_ms - (now_ms % 86_400_000)
    result = await db.execute(
        select(func.coalesce(func.sum(func.abs(LedgerEntry.amount)), 0))
        .where(
            and_(
                LedgerEntry.category == LedgerCategory.DISTRACTION,
                LedgerEntry.timestamp_ms >= today_start_ms,
            )
        )
    )
    drain_today = result.scalar_one()
    if drain_today > 0:
        return int(pass_def.virtual_price * pass_def.guilt_tax_pct)
    return 0


async def _auto_expire_passes(db: AsyncSession, now_ms: int) -> None:
    result = await db.execute(
        select(PurchasedPass).where(
            and_(
                PurchasedPass.status == PassStatus.ACTIVE,
                PurchasedPass.expires_at_ms.isnot(None),
                PurchasedPass.expires_at_ms <= now_ms,
            )
        )
    )
    expired = result.scalars().all()
    for p in expired:
        p.status = PassStatus.EXPIRED
    if expired:
        await db.flush()


async def _claim_loot_bonus_minutes(db: AsyncSession, pass_type: PassType) -> int:
    result = await db.execute(
        select(LedgerEntry).where(
            and_(
                LedgerEntry.category == LedgerCategory.BOSS_REWARD,
                LedgerEntry.description.like("Free Scroll pass%"),
                LedgerEntry.linked_dispute_id.is_(None),
            )
        ).limit(1)
    )
    loot_entry = result.scalar_one_or_none()
    if not loot_entry:
        return 0

    import re
    match = re.search(r"(\d+)min", loot_entry.description)
    minutes = int(match.group(1)) if match else 0

    loot_entry.linked_dispute_id = -1
    await db.flush()
    return minutes
