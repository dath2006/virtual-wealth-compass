from sqlalchemy import BigInteger, Integer, Float, Boolean, Date
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import datetime

class DailyStats(Base):
    __tablename__ = "daily_stats"

    id:                 Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    date:               Mapped[datetime.date] = mapped_column(Date, unique=True, nullable=False)
    minutes_worked:     Mapped[int]   = mapped_column(Integer, default=0)
    amount_earned:      Mapped[int]   = mapped_column(Integer, default=0)
    amount_spent:       Mapped[int]   = mapped_column(Integer, default=0)
    streak_count:       Mapped[int]   = mapped_column(Integer, default=0)
    earning_multiplier: Mapped[float] = mapped_column(Float, default=1.0)
    credit_score:       Mapped[int]   = mapped_column(Integer, default=600)
    mercy_tokens:       Mapped[int]   = mapped_column(Integer, default=1)
    target_hit:         Mapped[bool]  = mapped_column(Boolean, default=False)
    lazy_tax_applied:   Mapped[bool]  = mapped_column(Boolean, default=False)
    step_income_credited: Mapped[bool] = mapped_column(Boolean, default=False)
    sleep_multiplier:     Mapped[float] = mapped_column(Float, default=1.0)
    # Applied multiplicatively with streak multiplier: effective = streak_mult × sleep_mult

class AppSettings(Base):
    # Singleton table — always exactly 1 row (id=1)
    # Frontend reads and patches this via /settings
    __tablename__ = "app_settings"

    id:                    Mapped[int]   = mapped_column(Integer, primary_key=True, default=1)
    hourly_earn_rate:      Mapped[int]   = mapped_column(Integer, default=100)
    daily_target_hours:    Mapped[float] = mapped_column(Float, default=3.0)
    lazy_tax_amount:       Mapped[int]   = mapped_column(Integer, default=100)
    lazy_tax_threshold_pct: Mapped[float] = mapped_column(Float, default=0.5)
    step_income_cap:       Mapped[int]   = mapped_column(Integer, default=50)
    monthly_budget:        Mapped[int]   = mapped_column(Integer, default=3000)
    default_interest_rate: Mapped[float] = mapped_column(Float, default=0.05)
    study_hours_start:     Mapped[int]   = mapped_column(Integer, default=9)
    study_hours_end:       Mapped[int]   = mapped_column(Integer, default=22)
    unlock_tax_amount:     Mapped[int]   = mapped_column(Integer, default=20)
    salary_day_of_week:    Mapped[int]   = mapped_column(Integer, default=6)  # 6=Sunday
