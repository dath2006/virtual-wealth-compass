import enum
from sqlalchemy import BigInteger, Integer, String, Boolean, Enum, Date, Float
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import datetime


class ChallengeStatus(str, enum.Enum):
    ACTIVE    = "ACTIVE"
    COMPLETED = "COMPLETED"
    FAILED    = "FAILED"
    EXPIRED   = "EXPIRED"


class RewardType(str, enum.Enum):
    RUPEE_PAYOUT     = "RUPEE_PAYOUT"
    MERCY_TOKEN      = "MERCY_TOKEN"
    MULTIPLIER_BOOST = "MULTIPLIER_BOOST"   # +0.2× for 3 days


class AIChallenge(Base):
    __tablename__ = "ai_challenges"

    id:              Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title:           Mapped[str]   = mapped_column(String(200), nullable=False)
    description:     Mapped[str]   = mapped_column(String(500), nullable=False)
    metric_type:     Mapped[str]   = mapped_column(String(50), nullable=False)
    # "DISTRACTION_DRAIN_MAX" | "STUDY_HOURS_MIN" | "EXERCISE_COUNT"
    # | "STREAK_DAYS" | "STEP_COUNT_MIN" | "SLEEP_QUALITY_MIN"

    metric_target:   Mapped[float] = mapped_column(Float, nullable=False)
    # e.g. for DISTRACTION_DRAIN_MAX: 100 (means drain must stay under ₹100)

    metric_package:  Mapped[str]   = mapped_column(String(200), nullable=True)
    # For app-specific challenges: "com.instagram.android"

    current_value:   Mapped[float] = mapped_column(Float, default=0)
    status:          Mapped[ChallengeStatus] = mapped_column(
                         Enum(ChallengeStatus), default=ChallengeStatus.ACTIVE)

    reward_type:     Mapped[RewardType] = mapped_column(Enum(RewardType))
    reward_value:    Mapped[int]  = mapped_column(Integer, nullable=False)

    generated_at:    Mapped[datetime.date] = mapped_column(Date, nullable=False)
    expires_at:      Mapped[datetime.date] = mapped_column(Date, nullable=False)
    completed_at:    Mapped[datetime.date] = mapped_column(Date, nullable=True)

    ai_rationale:    Mapped[str]  = mapped_column(String(300), nullable=True)
    # Why the AI chose this challenge — shown to user for transparency
