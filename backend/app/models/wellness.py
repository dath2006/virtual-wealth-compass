import enum
from sqlalchemy import BigInteger, Integer, Float, String, Boolean, Enum, Date
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time, datetime


class SleepQuality(str, enum.Enum):
    EXCELLENT = "EXCELLENT"   # 8–9 hrs
    GOOD      = "GOOD"        # 7–8 hrs
    ADEQUATE  = "ADEQUATE"    # 6–7 hrs
    POOR      = "POOR"        # 5–6 hrs
    BAD       = "BAD"         # < 5 hrs


class SleepSession(Base):
    __tablename__ = "sleep_sessions"

    id:             Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    sleep_at_ms:    Mapped[int]   = mapped_column(BigInteger, nullable=False)
    wake_at_ms:     Mapped[int]   = mapped_column(BigInteger, nullable=True)
    # wake_at_ms is NULL while session is open (user is asleep)

    duration_hours: Mapped[float] = mapped_column(Float, nullable=True)
    quality:        Mapped[SleepQuality] = mapped_column(Enum(SleepQuality), nullable=True)
    source:         Mapped[str]   = mapped_column(String(20), default="MANUAL")
    # "MANUAL" | "HEALTHCONNECT"

    multiplier_effect: Mapped[float] = mapped_column(Float, nullable=True)
    # The earning multiplier modifier applied to tomorrow based on this sleep.
    # Stored for audit — the actual multiplier is in DailyStats.

    ledger_entry_id: Mapped[int]  = mapped_column(BigInteger, nullable=True)
    # Points to the SLEEP_BONUS or SLEEP_PENALTY ledger entry if any was created.

    date:           Mapped[datetime.date] = mapped_column(Date, nullable=True)
    # The date this sleep is attributed to (the date you WOKE UP)


class ExerciseSession(Base):
    __tablename__ = "exercise_sessions"

    id:             Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exercise_type:  Mapped[str]   = mapped_column(String(50), nullable=False)
    # "RUNNING" | "CYCLING" | "GYM" | "YOGA" | "SPORTS" | "WALK" | "OTHER"

    duration_minutes: Mapped[float] = mapped_column(Float, nullable=False)
    source:           Mapped[str]   = mapped_column(String(20), default="HEALTHCONNECT")
    started_at_ms:    Mapped[int]   = mapped_column(BigInteger, nullable=False)
    earned_amount:    Mapped[int]   = mapped_column(Integer, default=0)
    ledger_entry_id:  Mapped[int]   = mapped_column(BigInteger, nullable=True)
    date:             Mapped[datetime.date] = mapped_column(Date, nullable=True)
