from sqlalchemy import BigInteger, String, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time

class UsageSnapshot(Base):
    __tablename__ = "usage_snapshots"

    id:              Mapped[int]  = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    device_id:       Mapped[str]  = mapped_column(String(100), nullable=False)
    period_start_ms: Mapped[int]  = mapped_column(BigInteger, nullable=False)
    period_end_ms:   Mapped[int]  = mapped_column(BigInteger, nullable=False)
    app_usages_json: Mapped[str]  = mapped_column(Text, nullable=False)  # JSON serialized list of app usages
    processed:       Mapped[bool] = mapped_column(Boolean, default=False)
    created_at_ms:   Mapped[int]  = mapped_column(BigInteger, default=lambda: int(time.time() * 1000))
