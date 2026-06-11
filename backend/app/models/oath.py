import enum
from sqlalchemy import BigInteger, Integer, Float, String, Enum
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time

class OathStatus(str, enum.Enum):
    ACTIVE         = "ACTIVE"
    OVERDUE        = "OVERDUE"
    REPAID_EARLY   = "REPAID_EARLY"
    REPAID_ON_TIME = "REPAID_ONTIME"  # spelling matches frontend
    DEFAULTED      = "DEFAULTED"

class Oath(Base):
    __tablename__ = "oaths"

    id:                   Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    initial_loan_amount:  Mapped[int]   = mapped_column(Integer, nullable=False)
    current_debt_amount:  Mapped[int]   = mapped_column(Integer, nullable=False)
    task_description:     Mapped[str]   = mapped_column(String(500), nullable=False)
    due_date_ms:          Mapped[int]   = mapped_column(BigInteger, nullable=False)
    daily_interest_rate:  Mapped[float] = mapped_column(Float, default=0.05)
    status:               Mapped[OathStatus] = mapped_column(Enum(OathStatus), default=OathStatus.ACTIVE)
    created_at_ms:        Mapped[int]   = mapped_column(BigInteger, default=lambda: int(time.time() * 1000))
    repaid_at_ms:         Mapped[int]   = mapped_column(BigInteger, nullable=True)
    credit_score_delta:   Mapped[int]   = mapped_column(Integer, default=0)
    # credit_score_delta is filled on resolution: +50 early, +20 on-time, -100 default
