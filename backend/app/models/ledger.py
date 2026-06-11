import enum
from sqlalchemy import BigInteger, Integer, String, Boolean, Enum, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time

class LedgerCategory(str, enum.Enum):
    NFC           = "NFC"           # earned from desk tag session
    SMS_UPI       = "SMS_UPI"       # UPI debit from SMS channel
    NOTIFICATION_UPI = "NOTIFICATION_UPI"  # UPI debit from notification channel
    DISTRACTION   = "DISTRACTION"   # app usage drain
    OATH_LOAN     = "OATH_LOAN"     # loan credited to wallet
    OATH_INTEREST = "OATH_INTEREST" # compound interest penalty
    LAZY_TAX      = "LAZY_TAX"      # missed daily target
    STEP_INCOME   = "STEP_INCOME"   # walking income
    MANUAL        = "MANUAL"        # manually verified evidence
    BOSS_REWARD   = "BOSS_REWARD"   # boss fight loot drop
    REVERSAL      = "REVERSAL"      # dispute reversal
    SURGE         = "SURGE"         # surge pricing top-up
    MERCY_SPEND   = "MERCY_SPEND"   # unlock tax (bankrupt unlock)
    OATH          = "OATH"          # maps to OATH
    OATH_REPAY    = "OATH_REPAY"    # oath repayment
    SLEEP_EVENT   = "SLEEP_EVENT"   # sleep quality modifier (₹0 amount, rate modifier)
    EXERCISE_INCOME = "EXERCISE_INCOME"  # exercise earn (running, gym, yoga, etc.)

class SpendClass(str, enum.Enum):
    ESSENTIAL      = "ESSENTIAL"
    DISCRETIONARY  = "DISCRETIONARY"
    UNKNOWN        = "UNKNOWN"

class LedgerEntry(Base):
    __tablename__ = "ledger_entries"

    id:               Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    amount:           Mapped[int]   = mapped_column(Integer, nullable=False)
    # RULE: positive = earn, negative = spend/penalty. Never update, only insert.

    category:         Mapped[LedgerCategory] = mapped_column(Enum(LedgerCategory), nullable=False)
    description:      Mapped[str]   = mapped_column(String(500), nullable=False)
    merchant_name:    Mapped[str]   = mapped_column(String(100), nullable=True)
    spend_class:      Mapped[SpendClass] = mapped_column(Enum(SpendClass), nullable=True)
    device_id:        Mapped[str]   = mapped_column(String(100), nullable=True)
    dedup_key:        Mapped[str]   = mapped_column(String(64), nullable=True, unique=True)
    # dedup_key prevents double-insert from Android dual-channel (SMS + notification)

    timestamp_ms:     Mapped[int]   = mapped_column(BigInteger, default=lambda: int(time.time() * 1000))
    is_disputed:      Mapped[bool]  = mapped_column(Boolean, default=False)
    linked_dispute_id: Mapped[int]  = mapped_column(BigInteger, nullable=True)
    is_verified_by_ai: Mapped[bool] = mapped_column(Boolean, default=False)
    raw_payload:      Mapped[str]   = mapped_column(String(1000), nullable=True)
    # raw_payload stores the full Android event JSON for audit trail

    __table_args__ = (
        Index("idx_ledger_timestamp", "timestamp_ms"),
        Index("idx_ledger_category", "category"),
        Index("idx_ledger_disputed", "is_disputed"),
    )
