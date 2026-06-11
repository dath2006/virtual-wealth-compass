from pydantic import BaseModel
from typing import Optional
from enum import Enum

class UpiSource(str, Enum):
    NOTIFICATION = "NOTIFICATION"
    SMS          = "SMS"

class UpiDebitPayload(BaseModel):
    amount_rupees: int
    merchant_name: Optional[str] = None
    raw_text:      str
    source:        UpiSource
    dedup_key:     str

class NfcSessionPayload(BaseModel):
    tag_id:    str
    tag_label: str = "Desk Tag"

class AppUsageEntry(BaseModel):
    package_name: str
    app_label:    str
    minutes_used: int

class UsageReportPayload(BaseModel):
    period_start_ms: int
    period_end_ms:   int
    app_usages:      list[AppUsageEntry]

class StepsPayload(BaseModel):
    steps_today: int
    date:        str   # "2025-06-11"

class HeartbeatPayload(BaseModel):
    battery_pct:       int
    is_charging:       bool
    service_uptime_ms: int

# Generic envelope wrapping all events — matches Android EventEnvelope<T>
class EventEnvelope(BaseModel):
    device_id:    str
    timestamp_ms: int
    event_type:   str
    payload:      dict   # parsed to specific type in router
