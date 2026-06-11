from sqlalchemy import BigInteger, Integer, String, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class DeviceHeartbeat(Base):
    __tablename__ = "device_heartbeats"

    device_id:    Mapped[str]  = mapped_column(String(100), primary_key=True)
    last_seen_ms: Mapped[int]  = mapped_column(BigInteger, nullable=False)
    battery_pct:  Mapped[int]  = mapped_column(Integer, nullable=False)
    is_charging:  Mapped[bool] = mapped_column(Boolean, nullable=False)
