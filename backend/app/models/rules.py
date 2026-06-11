from sqlalchemy import Integer, String, Boolean, Enum
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import enum

class AppCategory(str, enum.Enum):
    SOCIAL        = "SOCIAL"
    ENTERTAINMENT = "ENTERTAINMENT"
    SHOPPING      = "SHOPPING"
    GAMING        = "GAMING"
    OTHER         = "OTHER"

class DistractionRule(Base):
    __tablename__ = "distraction_rules"

    package_name:          Mapped[str]  = mapped_column(String(200), primary_key=True)
    app_label:             Mapped[str]  = mapped_column(String(100), nullable=False)
    category:              Mapped[AppCategory] = mapped_column(Enum(AppCategory), default=AppCategory.SOCIAL)
    cost_per_minute:       Mapped[int]  = mapped_column(Integer, default=2)
    surge_cost_per_minute: Mapped[int]  = mapped_column(Integer, default=8)
    monthly_cap_minutes:   Mapped[int]  = mapped_column(Integer, default=0)  # 0 = no cap
    is_surge_enabled:      Mapped[bool] = mapped_column(Boolean, default=True)

class SpendingCap(Base):
    __tablename__ = "spending_caps"

    category:             Mapped[AppCategory] = mapped_column(Enum(AppCategory), primary_key=True)
    monthly_cap_rupees:   Mapped[int]  = mapped_column(Integer, default=0)
    current_month_spent:  Mapped[int]  = mapped_column(Integer, default=0)
    reset_day_of_month:   Mapped[int]  = mapped_column(Integer, default=1)
