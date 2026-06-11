import enum
from sqlalchemy import BigInteger, Integer, Float, String, Boolean, Enum
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time

class LootType(str, enum.Enum):
    RUPEE_PAYOUT    = "RUPEE_PAYOUT"     # flat ₹ credited to ledger
    MERCY_TOKEN     = "MERCY_TOKEN"      # +1 mercy token
    FREE_SCROLL     = "FREE_SCROLL"      # X minutes of zero-cost distraction
    INTEREST_FREE   = "INTEREST_FREE"    # next Oath has 0% interest

class BossFightStatus(str, enum.Enum):
    ACTIVE    = "ACTIVE"      # deadline not passed, hours not complete
    BEATEN    = "BEATEN"      # current_hours >= target_hours before deadline
    FAILED    = "FAILED"      # deadline passed without completion
    ABANDONED = "ABANDONED"   # manually cancelled

class BossFight(Base):
    __tablename__ = "boss_fights"

    id:             Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title:          Mapped[str]   = mapped_column(String(200), nullable=False)
    # e.g. "DBMS End Sem", "DAA Project Submission"

    target_hours:   Mapped[float] = mapped_column(Float, nullable=False)
    # total focus hours required to beat this boss

    current_hours:  Mapped[float] = mapped_column(Float, default=0.0)
    # accumulated via NFC sessions — never manually edited

    deadline_ms:    Mapped[int]   = mapped_column(BigInteger, nullable=False)
    # unix ms timestamp of the deadline

    status:         Mapped[BossFightStatus] = mapped_column(
                        Enum(BossFightStatus), default=BossFightStatus.ACTIVE)

    loot_type:      Mapped[LootType] = mapped_column(
                        Enum(LootType), default=LootType.RUPEE_PAYOUT)

    loot_value:     Mapped[int]   = mapped_column(Integer, default=500)
    # For RUPEE_PAYOUT: ₹ amount. For FREE_SCROLL: minutes. For others: 1 = granted.

    loot_awarded:   Mapped[bool]  = mapped_column(Boolean, default=False)
    # Idempotency flag — loot is awarded exactly once, even if NFC retries fire.

    loot_ledger_entry_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    # Points to the LedgerEntry that was created when loot was awarded.

    created_at_ms:  Mapped[int]   = mapped_column(BigInteger,
                        default=lambda: int(time.time() * 1000))
    beaten_at_ms:   Mapped[int]   = mapped_column(BigInteger, nullable=True)
    failed_at_ms:   Mapped[int]   = mapped_column(BigInteger, nullable=True)
