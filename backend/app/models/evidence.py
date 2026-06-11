from sqlalchemy import BigInteger, Integer, Float, String, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time

class EvidenceSubmission(Base):
    __tablename__ = "evidence_submissions"

    id:                Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    claim_description: Mapped[str]   = mapped_column(String(500), nullable=False)
    subject:           Mapped[str]   = mapped_column(String(100), nullable=False)
    claimed_amount:    Mapped[int]   = mapped_column(Integer, nullable=False)
    hourly_rate:       Mapped[int]   = mapped_column(Integer, nullable=False)
    image_base64:      Mapped[str]   = mapped_column(Text, nullable=False)
    
    verified:          Mapped[bool]  = mapped_column(Boolean, default=False)
    approved_amount:   Mapped[int]   = mapped_column(Integer, default=0)
    reasoning:         Mapped[str]   = mapped_column(String(500), nullable=True)
    confidence:        Mapped[float] = mapped_column(Float, default=0.0)
    
    ledger_entry_id:   Mapped[int]   = mapped_column(BigInteger, nullable=True)
    created_at_ms:     Mapped[int]   = mapped_column(BigInteger, default=lambda: int(time.time() * 1000))
