from sqlalchemy import BigInteger, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time


class RateSuggestion(Base):
    __tablename__ = "rate_suggestions"

    id:              Mapped[int]  = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    field:           Mapped[str]  = mapped_column(String(100), nullable=False)
    # "hourly_earn_rate" | "lazy_tax_amount" | "distraction_cost_per_minute" | "surge_cost_per_minute"

    target_package:  Mapped[str]  = mapped_column(String(200), nullable=True)
    # Only for distraction rule suggestions: "com.instagram.android"

    current_value:   Mapped[int]  = mapped_column(Integer, nullable=False)
    suggested_value: Mapped[int]  = mapped_column(Integer, nullable=False)
    reason:          Mapped[str]  = mapped_column(String(500), nullable=False)
    impact:          Mapped[str]  = mapped_column(String(300), nullable=False)
    status:          Mapped[str]  = mapped_column(String(20), default="PENDING")
    # "PENDING" | "APPLIED" | "DISMISSED"

    generated_at:    Mapped[int]  = mapped_column(BigInteger,
                         default=lambda: int(time.time() * 1000))
