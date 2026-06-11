import enum
from sqlalchemy import BigInteger, Integer, String, Boolean, Enum, Float
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time


class DeductionStatus(str, enum.Enum):
    PENDING_AI  = "PENDING_AI"   # submitted, waiting for AI verdict
    APPROVED    = "APPROVED"     # AI approved it
    REJECTED    = "REJECTED"     # AI rejected it
    OVERRIDDEN  = "OVERRIDDEN"   # AI rejected but user overrode (with extra tax)


class ManualDeduction(Base):
    __tablename__ = "manual_deductions"

    id:              Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    amount:          Mapped[int]   = mapped_column(Integer, nullable=False)
    reason:          Mapped[str]   = mapped_column(String(500), nullable=False)
    # User explains WHY they deserve this penalty
    # e.g. "I wasted 2 hours procrastinating instead of studying DBMS"

    category:        Mapped[str]   = mapped_column(String(50), default="SELF_PENALTY")
    # "SELF_PENALTY" | "HABIT_BREACH" | "RULE_VIOLATION" | "CUSTOM"

    ai_verdict:      Mapped[str]   = mapped_column(String(50), nullable=True)
    # "APPROVED" | "REJECTED" | "REDUCED"

    ai_reasoning:    Mapped[str]   = mapped_column(String(500), nullable=True)
    ai_suggested_amount: Mapped[int] = mapped_column(Integer, nullable=True)
    # AI may suggest a lower amount if the self-penalty seems excessive

    status:          Mapped[DeductionStatus] = mapped_column(
                         Enum(DeductionStatus), default=DeductionStatus.PENDING_AI)

    ledger_entry_id: Mapped[int]   = mapped_column(BigInteger, nullable=True)
    submitted_at_ms: Mapped[int]   = mapped_column(BigInteger,
                         default=lambda: int(time.time() * 1000))
    resolved_at_ms:  Mapped[int]   = mapped_column(BigInteger, nullable=True)
    override_tax_paid: Mapped[int] = mapped_column(Integer, default=0)
    # If AI rejects but user overrides, they pay an extra 20% "stubbornness tax"
