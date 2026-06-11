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
