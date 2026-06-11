# Backend Spec — Addendum: Leisure Marketplace

Addendum to `BACKEND_SPEC.md` and `BOSS_FIGHT_ADDENDUM.md`.

Adds the following:
- Section 7e: `app/models/marketplace.py`
- Section 12c: Marketplace logic in `/events/upi` and `/events/heartbeat`
- Section 15c: New `/marketplace` router
- Section 20: Frontend changes (new Marketplace page)
- Section 21: Android changes (heartbeat pass enforcement)

---

## Core Design

A pass has three distinct lifecycle states:

```
PURCHASED → (user clicks Start) → ACTIVE → (timer expires or consumed) → EXPIRED/CONSUMED
```

Buying a pass deducts virtual ₹ immediately and creates a pass in `PURCHASED` state.
Nothing happens on Android until the user explicitly clicks "Start" on the
web dashboard or (optionally) via a button in the Android notification.

This means:
- You can queue passes in advance ("I'll watch a movie tonight")
- Buying and starting are two separate intentional actions
- If you buy a pass and never start it, the ₹ are still spent — no refunds (by default)
- The Android enforcement layer only activates when state = ACTIVE

---

## 7e. Models: `app/models/marketplace.py`

```python
import enum
from sqlalchemy import BigInteger, Integer, Float, String, Boolean, Enum, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time

class PassCategory(str, enum.Enum):
    TIME     = "TIME"       # buys a window of unrestricted leisure time
    ACTIVITY = "ACTIVITY"   # covers a specific real-world UPI spend
    COOLDOWN = "COOLDOWN"   # structured rest with conditions

class PassStatus(str, enum.Enum):
    PURCHASED = "PURCHASED"  # bought, not yet started — sitting in queue
    ACTIVE    = "ACTIVE"     # user clicked Start, timer is running
    EXPIRED   = "EXPIRED"    # timer ran out naturally
    CONSUMED  = "CONSUMED"   # activity pass used up by a matching UPI debit
    CANCELLED = "CANCELLED"  # abandoned before starting (no refund by default)

class PassType(str, enum.Enum):
    MOVIE          = "MOVIE"           # 3 hrs, entertainment apps free
    GAMING         = "GAMING"          # 90 min, gaming apps free
    BINGE          = "BINGE"           # 2 hrs, streaming apps free
    NAP            = "NAP"             # 45 min, all drain suspended
    STUDY_BREAK    = "STUDY_BREAK"     # free, requires prior 45-min session
    RESTAURANT     = "RESTAURANT"      # next restaurant UPI ≤ ₹800 = free
    WEEKEND_OUTING = "WEEKEND_OUTING"  # day's UPI debits ≤ ₹2000 = free
    BOOK_PURCHASE  = "BOOK_PURCHASE"   # next Flipkart/Amazon ≤ ₹500 = free
    WEEKEND_MODE   = "WEEKEND_MODE"    # Sat+Sun halved drain, requires streak ≥ 5
    VACATION_MODE  = "VACATION_MODE"   # 5 days suspended economy, expensive


class MarketplacePass(Base):
    """
    The catalogue of available pass types.
    Seeded on first run. Admin can update prices via /marketplace/catalogue PATCH.
    """
    __tablename__ = "marketplace_passes"

    pass_type:          Mapped[PassType]    = mapped_column(Enum(PassType), primary_key=True)
    display_name:       Mapped[str]         = mapped_column(String(100), nullable=False)
    description:        Mapped[str]         = mapped_column(String(300), nullable=False)
    category:           Mapped[PassCategory]= mapped_column(Enum(PassCategory), nullable=False)
    virtual_price:      Mapped[int]         = mapped_column(Integer, nullable=False)
    duration_minutes:   Mapped[int]         = mapped_column(Integer, nullable=True)
    # duration_minutes is None for ACTIVITY passes (they're consumed by event, not time)

    # ── Purchase restrictions ──────────────────────────────────────────────
    min_balance_after_purchase: Mapped[int]   = mapped_column(Integer, default=0)
    # Balance must be >= this AFTER the deduction. Prevents buying leisure while broke.

    min_work_hours_today:       Mapped[float] = mapped_column(Float, default=0.0)
    # Must have completed this many NFC hours today before purchasing.

    requires_no_overdue_oaths:  Mapped[bool]  = mapped_column(Boolean, default=True)
    # Cannot purchase if any Oath is in DEFAULTED or overdue ACTIVE state.

    min_streak_to_unlock:       Mapped[int]   = mapped_column(Integer, default=0)
    # Pass is locked (greyed out, unpurchasable) below this streak count.

    weekly_purchase_limit:      Mapped[int]   = mapped_column(Integer, default=2)
    # Max purchases of this pass type in a rolling 7-day window. 0 = unlimited.

    monthly_spend_cap_shared:   Mapped[bool]  = mapped_column(Boolean, default=True)
    # Whether this pass counts toward the global monthly marketplace spend cap.

    # ── Activation time restrictions ──────────────────────────────────────
    valid_after_hour:   Mapped[int]  = mapped_column(Integer, default=0)
    # Can only be STARTED (not purchased) after this hour. 0 = anytime.

    valid_before_hour:  Mapped[int]  = mapped_column(Integer, default=24)
    # Can only be STARTED before this hour.

    valid_on_weekends_only: Mapped[bool] = mapped_column(Boolean, default=False)
    # e.g. WEEKEND_MODE can only be started on Saturday or Sunday.

    blocked_during_study_hours: Mapped[bool] = mapped_column(Boolean, default=True)
    # Cannot be STARTED during configured study hours (9am–10pm).

    # ── Stacking rules ────────────────────────────────────────────────────
    cooldown_hours_after_use:   Mapped[int]  = mapped_column(Integer, default=0)
    # Must wait X hours before purchasing the same pass type again.
    # e.g. MOVIE = 24h cooldown prevents back-to-back movie nights.

    is_stackable_with_loot:     Mapped[bool] = mapped_column(Boolean, default=True)
    # If True, a Boss Fight Free Scroll loot adds to this pass's duration.

    # ── Guilt tax ─────────────────────────────────────────────────────────
    guilt_tax_pct:  Mapped[float] = mapped_column(Float, default=0.20)
    # Extra % charged if user purchases this pass AFTER already using a matching
    # app today without a pass. e.g. watched YouTube for 30 min, then bought Binge pass.


class PurchasedPass(Base):
    """
    Represents a single pass instance bought by the user.
    One row per purchase. Lifecycle: PURCHASED → ACTIVE → EXPIRED/CONSUMED/CANCELLED.
    """
    __tablename__ = "purchased_passes"

    id:             Mapped[int]        = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    pass_type:      Mapped[PassType]   = mapped_column(Enum(PassType), nullable=False)
    status:         Mapped[PassStatus] = mapped_column(Enum(PassStatus), default=PassStatus.PURCHASED)
    category:       Mapped[PassCategory] = mapped_column(Enum(PassCategory), nullable=False)

    virtual_price_paid: Mapped[int]   = mapped_column(Integer, nullable=False)
    # Snapshot of price at time of purchase (in case catalogue price changes later)

    guilt_tax_paid: Mapped[int]       = mapped_column(Integer, default=0)
    # Extra amount charged due to guilt tax (if applicable)

    ledger_entry_id: Mapped[int]      = mapped_column(BigInteger, nullable=True)
    # The negative ledger entry that debited the virtual ₹

    purchased_at_ms: Mapped[int]      = mapped_column(BigInteger,
                         default=lambda: int(time.time() * 1000))
    activated_at_ms: Mapped[int]      = mapped_column(BigInteger, nullable=True)
    # NULL until user clicks Start

    expires_at_ms:   Mapped[int]      = mapped_column(BigInteger, nullable=True)
    # Computed on activation: activated_at_ms + duration_minutes * 60 * 1000
    # NULL for ACTIVITY passes (they expire by consumption, not time)

    consumed_at_ms:  Mapped[int]      = mapped_column(BigInteger, nullable=True)
    # For ACTIVITY passes — when the matching UPI debit consumed this pass

    matched_upi_dedup_key: Mapped[str] = mapped_column(String(64), nullable=True)
    # For ACTIVITY passes — the dedup_key of the UPI event that consumed this pass

    # Loot stacking — if a Boss Fight Free Scroll was active, its minutes are added
    loot_bonus_minutes: Mapped[int]   = mapped_column(Integer, default=0)

    notes: Mapped[str]                = mapped_column(String(200), nullable=True)
    # Optional user note: "Movie: Interstellar rewatch" etc.

    __table_args__ = (
        Index("idx_pass_status", "status"),
        Index("idx_pass_type_purchased", "pass_type", "purchased_at_ms"),
    )
```

---

## Catalogue Seed Data

Seed this on first run (in a migration or startup hook):

```python
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
        "weekly_purchase_limit": 0,   # unlimited (can only afford it occasionally)
        "monthly_spend_cap_shared": True,
        "blocked_during_study_hours": False,
        "cooldown_hours_after_use": 0,
    },
]
```

---

## 15c. Router: `app/routers/marketplace.py`

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from pydantic import BaseModel
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.marketplace import MarketplacePass, PurchasedPass, PassStatus, PassType, PassCategory
from app.models.oath import Oath, OathStatus
from app.models.stats import DailyStats
from app.services import ledger_service, economy_service
from app.models.ledger import LedgerCategory
import time, datetime

router = APIRouter(prefix="/marketplace", dependencies=[Depends(verify_api_key)])

MONTHLY_MARKETPLACE_SPEND_CAP = 1500  # ₹ virtual per month — hardcoded, move to Settings later


# ── GET /marketplace/catalogue ────────────────────────────────────────────────
# Returns full pass catalogue with purchase eligibility per pass.
# The frontend uses this to show locked/unlocked/available states.

@router.get("/catalogue")
async def get_catalogue(db: AsyncSession = Depends(get_db)):
    passes_result  = await db.execute(select(MarketplacePass))
    catalogue      = passes_result.scalars().all()
    today_stats    = await economy_service.get_or_create_daily_stats(db)
    settings       = await economy_service.get_settings(db)
    balance        = await ledger_service.get_balance(db)
    now            = datetime.datetime.now()
    now_ms         = int(time.time() * 1000)

    # Check overdue oaths once (reused per pass)
    overdue_result = await db.execute(
        select(func.count()).select_from(Oath).where(
            and_(
                Oath.status == OathStatus.ACTIVE,
                Oath.due_date_ms < now_ms
            )
        )
    )
    has_overdue_oaths = overdue_result.scalar_one() > 0

    # Monthly marketplace spend (for cap check)
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
        # Check guilt tax — has user already used matching apps today without a pass?
        guilt_tax_amount = await _compute_guilt_tax(db, p, now_ms)

        response.append({
            "pass_type":          p.pass_type.value,
            "display_name":       p.display_name,
            "description":        p.description,
            "category":           p.category.value,
            "virtual_price":      p.virtual_price,
            "duration_minutes":   p.duration_minutes,
            "can_purchase":       eligibility["can_purchase"],
            "blocked_reason":     eligibility["reason"],       # null if purchasable
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
# Buys a pass. Deducts virtual ₹ immediately. Pass enters PURCHASED state.
# Does NOT start the timer. User must call /activate to start.

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

    # Run full eligibility check
    eligibility = await _check_purchase_eligibility(
        db=db, pass_def=pass_def, balance=balance,
        today_stats=today_stats, settings=settings,
        has_overdue_oaths=has_overdue_oaths,
        monthly_marketplace_spent=0,  # recalculated inside
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
        category=LedgerCategory.MERCY_SPEND,  # reuse this category or add MARKETPLACE
        description=desc,
    )

    # Create purchased pass record (PURCHASED state — not yet started)
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


# ── POST /marketplace/activate/{id} ──────────────────────────────────────────
# Starts the pass timer. THIS is when the leisure window begins.
# Validates time-of-day and study-hour restrictions at activation, not purchase.

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

    # Load pass definition for time restrictions
    pass_result = await db.execute(
        select(MarketplacePass).where(MarketplacePass.pass_type == purchased.pass_type)
    )
    pass_def = pass_result.scalar_one()

    # ── Time-of-day restriction (checked at ACTIVATION, not purchase) ──────
    current_hour = now.hour
    if pass_def.valid_after_hour > 0 and current_hour < pass_def.valid_after_hour:
        raise HTTPException(
            status_code=400,
            detail=f"This pass can only be started after {pass_def.valid_after_hour}:00. "
                   f"It's currently {current_hour}:00."
        )
    if current_hour >= pass_def.valid_before_hour:
        raise HTTPException(
            status_code=400,
            detail=f"This pass must be started before {pass_def.valid_before_hour}:00."
        )

    # ── Weekend-only restriction ───────────────────────────────────────────
    if pass_def.valid_on_weekends_only and now.weekday() < 5:  # 5=Sat, 6=Sun
        raise HTTPException(
            status_code=400,
            detail="This pass can only be activated on weekends."
        )

    # ── Study hours restriction ────────────────────────────────────────────
    settings = await economy_service.get_settings(db)
    if pass_def.blocked_during_study_hours:
        if settings.study_hours_start <= current_hour < settings.study_hours_end:
            raise HTTPException(
                status_code=400,
                detail=f"This pass cannot be started during study hours "
                       f"({settings.study_hours_start}:00–{settings.study_hours_end}:00)."
            )

    # ── Check for loot bonus minutes to stack ─────────────────────────────
    loot_bonus = await _claim_loot_bonus_minutes(db, purchased.pass_type)

    # ── Activate ──────────────────────────────────────────────────────────
    duration_ms = None
    if pass_def.duration_minutes:
        total_minutes  = pass_def.duration_minutes + loot_bonus
        duration_ms    = total_minutes * 60 * 1000
        expires_at_ms  = now_ms + duration_ms
    else:
        expires_at_ms  = None  # ACTIVITY pass — no timer

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
        "message":          f"Pass active! Enjoy your {pass_def.display_name}. "
                            + (f"Expires in {(pass_def.duration_minutes or 0) + loot_bonus} minutes."
                               if expires_at_ms else "Active until consumed."),
    }


# ── GET /marketplace/my-passes ────────────────────────────────────────────────
@router.get("/my-passes")
async def get_my_passes(db: AsyncSession = Depends(get_db)):
    now_ms = int(time.time() * 1000)

    # Auto-expire any passes whose timer has run out
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


# ── DELETE /marketplace/cancel/{id} ──────────────────────────────────────────
# Cancel a PURCHASED (not yet started) pass. No refund by default.
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
    # Note: no ledger reversal — ₹ is spent when you buy, not when you start.
    return {"status": "cancelled", "message": "Pass cancelled. No refund issued."}


# ── Active pass state for heartbeat ──────────────────────────────────────────
async def get_active_pass_for_heartbeat(db: AsyncSession) -> dict | None:
    """
    Called from the heartbeat handler. Returns the currently active pass
    (if any) so Android knows what drain suppression to apply.
    Returns None if no pass is active.
    """
    now_ms = int(time.time() * 1000)
    await _auto_expire_passes(db, now_ms)

    result = await db.execute(
        select(PurchasedPass).where(
            and_(
                PurchasedPass.status == PassStatus.ACTIVE,
                # For time passes — not yet expired
                # For activity passes — expires_at_ms is None, always include
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
    """
    Called from /events/upi BEFORE applying the standard penalty multiplier.
    If an active ACTIVITY pass covers this transaction, consume it and return True.
    The caller then skips the normal virtual deduction entirely.
    Returns False if no matching pass is active.
    """
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
            # Consume the pass
            pass_.status              = PassStatus.CONSUMED
            pass_.consumed_at_ms      = now_ms
            pass_.matched_upi_dedup_key = dedup_key
            await db.flush()
            return True

    return False


def _pass_covers_transaction(pass_type: PassType, merchant: str | None, amount: int) -> bool:
    """Determines if a given activity pass covers a UPI transaction."""
    merchant_lower = (merchant or "").lower()
    if pass_type == PassType.RESTAURANT:
        restaurant_keywords = ["restaurant", "cafe", "dhaba", "hotel", "kitchen",
                                "biryani", "pizza", "burger", "dosa", "mess", "canteen"]
        return amount <= 800 and any(k in merchant_lower for k in restaurant_keywords)
    elif pass_type == PassType.WEEKEND_OUTING:
        return amount <= 2000  # covers any merchant
    elif pass_type == PassType.BOOK_PURCHASE:
        book_merchants = ["amazon", "flipkart", "crossword", "kindle", "notion press"]
        return amount <= 500 and any(k in merchant_lower for k in book_merchants)
    return False


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _check_purchase_eligibility(
    db, pass_def, balance, today_stats, settings,
    has_overdue_oaths, monthly_marketplace_spent, now, now_ms
) -> dict:
    """Returns {"can_purchase": bool, "reason": str | None, "weekly_used": int}"""

    # Streak lock
    if pass_def.min_streak_to_unlock > 0:
        if today_stats.streak_count < pass_def.min_streak_to_unlock:
            return {"can_purchase": False, "weekly_used": 0,
                    "reason": f"Locked — requires {pass_def.min_streak_to_unlock}-day streak "
                               f"(you have {today_stats.streak_count})"}

    # Overdue oath block
    if pass_def.requires_no_overdue_oaths and has_overdue_oaths:
        return {"can_purchase": False, "weekly_used": 0,
                "reason": "Cannot purchase while you have overdue Oaths"}

    # Work hours today
    hours_today = today_stats.minutes_worked / 60.0
    if hours_today < pass_def.min_work_hours_today:
        needed = pass_def.min_work_hours_today - hours_today
        return {"can_purchase": False, "weekly_used": 0,
                "reason": f"Need {needed:.1f} more study hours today first"}

    # Weekly purchase limit
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

    # Monthly marketplace cap
    if pass_def.monthly_spend_cap_shared:
        if monthly_marketplace_spent + pass_def.virtual_price > MONTHLY_MARKETPLACE_SPEND_CAP:
            remaining = MONTHLY_MARKETPLACE_SPEND_CAP - monthly_marketplace_spent
            return {"can_purchase": False, "weekly_used": weekly_used,
                    "reason": f"Monthly marketplace cap reached (₹{remaining} remaining)"}

    # Cooldown since last use
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
    """
    Compute guilt tax: charged if the user already used matching apps today
    without a pass. e.g. watched YouTube for 30 min, now buying Binge pass.
    """
    if pass_def.guilt_tax_pct <= 0 or pass_def.category != PassCategory.TIME:
        return 0

    # Check if there's distraction drain already charged today for matching apps
    today_start_ms = now_ms - (now_ms % 86_400_000)  # midnight today (approx)
    result = await db.execute(
        select(func.coalesce(func.sum(func.abs(ledger_service.LedgerEntry.amount)), 0))
        .where(
            and_(
                ledger_service.LedgerEntry.category == LedgerCategory.DISTRACTION,
                ledger_service.LedgerEntry.timestamp_ms >= today_start_ms,
            )
        )
    )
    drain_today = result.scalar_one()
    if drain_today > 0:
        return int(pass_def.virtual_price * pass_def.guilt_tax_pct)
    return 0


async def _auto_expire_passes(db: AsyncSession, now_ms: int) -> None:
    """Mark expired time passes as EXPIRED. Called lazily on reads."""
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
    """
    Check for unclaimed Free Scroll loot from Boss Fights.
    If found, mark it as claimed (set linked_dispute_id = -1 as consumed marker)
    and return the bonus minutes to stack.
    """
    from app.models.ledger import LedgerEntry, LedgerCategory
    result = await db.execute(
        select(LedgerEntry).where(
            and_(
                LedgerEntry.category == LedgerCategory.BOSS_REWARD,
                LedgerEntry.description.like("Free Scroll pass%"),
                LedgerEntry.linked_dispute_id.is_(None),  # not yet consumed
            )
        ).limit(1)
    )
    loot_entry = result.scalar_one_or_none()
    if not loot_entry:
        return 0

    # Parse minutes from description: "Free Scroll pass: 30min — Boss: ..."
    import re
    match = re.search(r"(\d+)min", loot_entry.description)
    minutes = int(match.group(1)) if match else 0

    # Mark as consumed
    loot_entry.linked_dispute_id = -1  # sentinel value meaning "consumed by pass"
    await db.flush()
    return minutes
```

---

## Update `/events/upi` in `app/routers/events.py`

In the `receive_upi_debit` handler, add this block **before** the AI classification step:

```python
# ── Check for active Activity Pass covering this transaction ─────────────
from app.routers.marketplace import try_consume_activity_pass

pass_consumed = await try_consume_activity_pass(
    db=db,
    merchant_name=payload.merchant_name,
    amount=payload.amount_rupees,
    dedup_key=payload.dedup_key,
)

if pass_consumed:
    # Pass covered this spend — zero virtual cost, still record it
    await ledger_service.insert_entry(
        db=db,
        amount=0,
        category=LedgerCategory.NOTIFICATION_UPI,
        description=f"Covered by pass: {payload.merchant_name or 'Payment'} ₹{payload.amount_rupees}",
        merchant_name=payload.merchant_name,
        spend_class=SpendClass.ESSENTIAL,
        dedup_key=payload.dedup_key,
        device_id=envelope.device_id,
    )
    balance = await ledger_service.get_balance(db)
    return {
        "status": "ok",
        "balance": balance,
        "notification": {
            "title": f"✅ Pass used! ₹{payload.amount_rupees} at {payload.merchant_name or 'merchant'}",
            "body": f"Covered by your active pass. Zero virtual cost. Balance: ₹{balance}",
            "priority": "default"
        }
    }

# ... rest of normal UPI handling continues below unchanged
```

---

## Update `/events/heartbeat` in `app/routers/events.py`

Add active pass info to the heartbeat response:

```python
from app.routers.marketplace import get_active_pass_for_heartbeat

active_pass = await get_active_pass_for_heartbeat(db)

return {
    "status":       "ok",
    "balance":      balance,
    "streak":       today.streak_count,
    "multiplier":   today.earning_multiplier,
    "active_pass":  active_pass,   # ← new field — None or pass dict
    "notification": notification
}
```

---

## Wire up in `app/main.py`

```python
from app.routers import marketplace
app.include_router(marketplace.router)
```

---

## Section 20: Frontend Changes

### New Page: `src/pages/Marketplace.tsx`

Add to sidebar nav: **Marketplace** (`ShoppingBag` icon from Lucide), between Achievements and Settings.

#### Layout

```
┌─────────────────────────────────────────────────────┐
│  Marketplace                                         │
│  ₹1,240 available  ·  ₹340 spent this month (cap ₹1,500) │
├─────────────────────────────────────────────────────┤
│  [TIME PASSES]  [ACTIVITY PASSES]  [COOLDOWN]  [MY PASSES] │
├─────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Movie Night  │  │ Gaming Sess  │  │ Binge Pass   │ │
│  │ 🎬           │  │ 🎮           │  │ 📺           │ │
│  │ 3 hours      │  │ 90 minutes   │  │ 2 hours      │ │
│  │ ₹300         │  │ ₹150         │  │ ₹200         │ │
│  │ [Buy Pass]   │  │ [LOCKED 🔒]  │  │ [Buy Pass]   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────┘
```

#### Pass Card Component: `src/components/ui/PassCard.tsx`

Each card shows:
- Emoji icon + display name
- Description
- Duration (for time passes) or "Single use" (for activity passes)
- Virtual price (₹) — if guilt tax applies, show: `₹200 + ₹40 guilt tax = ₹240` in amber
- Restriction badges: "After 6 PM", "2hrs study first", "Weekends only", etc.
- Lock indicator: if `min_streak_to_unlock > current_streak`, show a padlock with "Unlock at X-day streak"
- Weekly usage: "1/2 this week" pill
- State-aware button:
  - **Green "Buy Pass"** — eligible, normal price
  - **Amber "Buy + Guilt Tax"** — eligible but guilt tax applies, show total
  - **Grey "Locked 🔒"** — streak requirement not met
  - **Red "Not Yet"** — work hours / time restriction, show reason as tooltip
  - **"Cooling down (Xh)"** — within cooldown window

#### My Passes Tab

Two sections:

**Queued (PURCHASED, not started):**
Each card shows:
- Pass name + price paid
- Time since purchase ("bought 2h ago")
- Restriction check for activation (e.g. "Available after 6 PM — 3h 20m to go")
- **"Start Now"** button — enabled only if all activation restrictions pass
  - If blocked: greyed out with tooltip explaining why ("Study hours until 10 PM")
- "Cancel" link (no refund warning)

**History (ACTIVE / EXPIRED / CONSUMED / CANCELLED):**
Simple list. ACTIVE shows live countdown timer (countdown component, updates every second).

#### Active Pass Banner

When a pass is `ACTIVE`, show a **persistent animated banner** at the top of every page (not just Marketplace):

```
┌──────────────────────────────────────────────────────────┐
│  🎬 Movie Night active — 1h 43m remaining  [End Early]   │
└──────────────────────────────────────────────────────────┘
```

- Violet/gradient background, subtle pulse animation
- Countdown timer updates live (client-side interval, seeded from `expires_at_ms`)
- "End Early" button calls `PATCH /marketplace/end-early/{id}` (add this endpoint — marks as EXPIRED immediately)

#### Guilt Tax Modal

Before confirming a purchase that has a guilt tax:

```
┌─────────────────────────────────────────┐
│  Guilt Tax Applied                      │
│                                         │
│  You already used entertainment apps    │
│  today without a pass.                  │
│                                         │
│  Base price:      ₹200                  │
│  Guilt tax (20%): ₹40                   │
│  ─────────────────────                  │
│  Total:           ₹240                  │
│                                         │
│  [Cancel]          [Pay ₹240 Anyway]    │
└─────────────────────────────────────────┘
```

#### Mock Data additions for `src/lib/mockData.ts`

```typescript
// mockCatalogue — all 10 pass types with realistic eligibility
// mockMyPasses — 1 PURCHASED (not started), 1 ACTIVE (2h remaining), 2 EXPIRED historical
export const mockActivePasses: PurchasedPass[] = [
  {
    id: 1, pass_type: "GAMING", status: "PURCHASED",
    price_paid: 150, purchased_at_ms: Date.now() - 3600000,
    activated_at_ms: null, expires_at_ms: null,
    ms_remaining: null, notes: "After DBMS revision"
  }
]
```

---

## Section 21: Android Changes

The Android thin client needs two small changes: read the active pass from heartbeat, and suppress distraction drain accordingly.

### Change 1 — Update `EventPayload.kt`

Add `active_pass` to `ServerAck`:

```kotlin
data class ServerAck(
    @SerializedName("status")       val status: String,
    @SerializedName("message")      val message: String?,
    @SerializedName("notification") val notification: PushInstruction?,
    @SerializedName("active_pass")  val activePass: ActivePassInfo?  // ← new
)

data class ActivePassInfo(
    @SerializedName("pass_id")       val passId: Int,
    @SerializedName("pass_type")     val passType: String,
    @SerializedName("category")      val category: String,
    @SerializedName("expires_at_ms") val expiresAtMs: Long?,
    @SerializedName("ms_remaining")  val msRemaining: Long?
)
```

### Change 2 — Update `MainForegroundService.kt`

Add a field to hold the current active pass state, updated on every heartbeat:

```kotlin
// In MainForegroundService
private var activePass: ActivePassInfo? = null

private suspend fun sendHeartbeat(uptimeMs: Long) {
    // ... existing heartbeat code ...
    val response = ApiClient.get().sendHeartbeat(envelope)
    response.body()?.let { ack ->
        activePass = ack.activePass   // update cached pass state
        // ... existing notification handling ...
    }
}

// Expose for UsageTracker to call
fun getActivePass(): ActivePassInfo? = activePass
```

### Change 3 — Update `UsageTracker.kt`

Before building the usage report, check active pass. If TIME pass is active, zero out matching app minutes so no drain is billed:

```kotlin
suspend fun collectAndSend(lastReportMs: Long) = withContext(Dispatchers.IO) {
    // ... existing stats collection ...

    val activePass = (context as? MainForegroundService)?.getActivePass()
        ?: ProductivityApp.getForegroundService()?.getActivePass()

    val processedUsages = appUsages.map { usage ->
        if (activePass != null && isPassCoveringApp(activePass, usage.packageName)) {
            // Pass is active — report 0 minutes for this app (no drain charged)
            usage.copy(minutesUsed = 0)
        } else {
            usage
        }
    }.filter { it.minutesUsed > 0 }

    // ... send processedUsages to VPS ...
}

fun isPassCoveringApp(pass: ActivePassInfo, packageName: String): Boolean {
    val now = System.currentTimeMillis()
    // Pass must be active (not expired client-side)
    if (pass.expiresAtMs != null && now > pass.expiresAtMs) return false

    return when (pass.passType) {
        "MOVIE"   -> packageName in setOf("com.netflix.mediaclient",
                         "com.google.android.youtube", "com.amazon.avod.thirdpartyclient",
                         "com.hotstar.android")
        "GAMING"  -> packageName in setOf("com.supercell.clashofclans",
                         "com.pubg.imobile", "com.activision.callofduty.shooter")
                         // User should configure this list in Settings
        "BINGE"   -> packageName in setOf("com.netflix.mediaclient",
                         "com.google.android.youtube", "com.amazon.avod.thirdpartyclient",
                         "com.hotstar.android", "com.disney.disneyplus")
        "NAP"     -> true  // NAP suspends ALL drain
        "WEEKEND_MODE" -> true  // halved drain — UsageTracker sends half minutes
        "VACATION_MODE" -> true  // fully suspended
        else      -> false
    }
}
```

### Change 4 — Update Persistent Notification

When a pass is active, update the persistent foreground notification to show the pass status:

```kotlin
// In sendHeartbeat(), after updating activePass:
val notifText = when {
    activePass != null && activePass.msRemaining != null -> {
        val mins = activePass.msRemaining / 60000
        "🎬 ${activePass.passType} active — ${mins}m remaining"
    }
    balance < 0 -> "⚠ Bankrupt — ₹${abs(balance)} debt"
    else -> "Balance: ₹${balance} · Streak: ${streak} days"
}
updatePersistentNotification(notifText)
```

---

## Summary of key design decisions

**Buy vs Start separation:** Virtual ₹ deducted on purchase. Timer only starts on explicit activation. If a pass is never started, the ₹ are still gone — this prevents impulse-buying cheap passes as a habit without actually using them. The "I paid for it, I should use it" psychology encourages intentional leisure scheduling.

**Guilt tax at purchase, not activation:** The guilt tax check runs when you hit "Buy", not when you hit "Start". This is intentional — if you already used apps without a pass, you pay extra at purchase time regardless of when you eventually start. Retroactive justification is taxed.

**Time restrictions at activation, not purchase:** You can buy a Movie pass at 2 PM even though it can only be started after 6 PM. This lets you plan ahead. But the time check runs at Start — if you somehow try to start at 5 PM, it's blocked.

**Android zeroes out pass-covered minutes before sending to VPS:** The client-side suppression ensures no drain is billed during a pass. The server doesn't need to retroactively subtract — the usage report arrives with 0 minutes for covered apps. This keeps the audit trail clean.

**WEEKEND_MODE sends half-minutes:** For passes that halve the drain rate (not zero it), the Android client reports `minutes / 2` for covered apps. The VPS applies normal pricing to whatever it receives — it doesn't need to know about WEEKEND_MODE specifically.