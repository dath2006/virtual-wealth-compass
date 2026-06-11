from sqlalchemy import BigInteger, Integer, Float, String, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class NfcSession(Base):
    __tablename__ = "nfc_sessions"

    id:               Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tag_id:           Mapped[str]   = mapped_column(String(64), nullable=False)
    tag_label:        Mapped[str]   = mapped_column(String(100), default="Desk Tag")
    device_id:        Mapped[str]   = mapped_column(String(100), nullable=True)
    start_ms:         Mapped[int]   = mapped_column(BigInteger, nullable=False)
    end_ms:           Mapped[int]   = mapped_column(BigInteger, nullable=True)
    # end_ms is null while session is open — filled on second tap

    duration_minutes: Mapped[float] = mapped_column(Float, nullable=True)
    base_earned:      Mapped[int]   = mapped_column(Integer, nullable=True)
    multiplier:       Mapped[float] = mapped_column(Float, nullable=True)
    final_earned:     Mapped[int]   = mapped_column(Integer, nullable=True)
    ledger_entry_id:  Mapped[int]   = mapped_column(BigInteger, nullable=True)
    is_open:          Mapped[bool]  = mapped_column(Boolean, default=True)
