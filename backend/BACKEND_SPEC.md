# Productivity Economy — Backend Specification
## FastAPI + PostgreSQL + Docker + Google AI Studio

---

## 1. What This Backend Does

This is the **brain** of the Productivity Economy system. The Android thin client (sensor layer) sends raw events to this server. This backend:

1. **Ingests events** from the Android app (UPI debits, NFC taps, usage reports, steps, heartbeats)
2. **Runs the ledger engine** — immutable double-entry style transaction log, balance = SUM of all rows
3. **Classifies UPI transactions** via Google AI Studio (Gemma) as Essential vs Discretionary
4. **Runs economy logic** — streak tracking, lazy tax, oath interest, distraction drain, step income
5. **Serves the React frontend** via a REST API
6. **Schedules nightly jobs** — midnight audit (streak eval, lazy tax, oath compounding)

Everything is containerised. One `docker compose up` starts the entire stack.

---

## 2. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | **FastAPI** (Python 3.11) | Async, typed, auto OpenAPI docs |
| Database | **PostgreSQL 15** | Relational, JSON columns for flexible payloads |
| ORM | **SQLAlchemy 2.0** (async) | Async sessions, typed models |
| Migrations | **Alembic** | Version-controlled schema changes |
| Scheduler | **APScheduler** | In-process cron for midnight audit |
| AI | **Google AI Studio API** (Gemini 1.5 Flash) | Free tier, handles text classification + vision |
| Container | **Docker + Docker Compose** | Single command deploy |
| Config | **pydantic-settings** | `.env` typed config with validation |
| HTTP | **httpx** | Async HTTP client for AI Studio calls |

---

## 3. Project File Structure

```
productivity-backend/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── alembic.ini
├── alembic/
│   └── versions/           ← migration files (auto-generated)
├── app/
│   ├── main.py             ← FastAPI app, lifespan, router registration
│   ├── config.py           ← pydantic-settings config
│   ├── database.py         ← async SQLAlchemy engine + session
│   ├── models/
│   │   ├── __init__.py
│   │   ├── ledger.py       ← LedgerEntry, LedgerCategory enum
│   │   ├── oath.py         ← Oath, OathStatus, CreditScore
│   │   ├── session.py      ← NfcSession
│   │   ├── stats.py        ← DailyStats
│   │   ├── rules.py        ← DistractionRule, SpendingCap
│   │   ├── evidence.py     ← EvidenceSubmission
│   │   └── device.py       ← DeviceHeartbeat
│   ├── schemas/
│   │   ├── events.py       ← Pydantic models for Android payloads
│   │   ├── api.py          ← Pydantic models for frontend responses
│   │   └── settings.py     ← Settings read/write schemas
│   ├── routers/
│   │   ├── events.py       ← POST /events/* (Android → server)
│   │   ├── ledger.py       ← GET /ledger (frontend)
│   │   ├── dashboard.py    ← GET /dashboard (aggregated stats)
│   │   ├── sessions.py     ← GET /sessions (NFC history)
│   │   ├── oaths.py        ← GET/POST/PATCH /oaths
│   │   ├── settings.py     ← GET/PATCH /settings
│   │   ├── usage.py        ← GET /usage (distraction stats)
│   │   └── health.py       ← GET /health (connection test)
│   ├── services/
│   │   ├── ledger_service.py     ← insert_entry(), get_balance(), compute_balance()
│   │   ├── economy_service.py    ← streak logic, lazy tax, multipliers
│   │   ├── oath_service.py       ← create_oath(), apply_interest(), repay()
│   │   ├── usage_service.py      ← apply_distraction_drain()
│   │   ├── step_service.py       ← apply_step_income()
│   │   ├── ai_service.py         ← Google AI Studio calls
│   │   └── audit_service.py      ← midnight_audit() — the nightly job
│   └── middleware/
│       └── auth.py               ← API key validation
└── requirements.txt
```

---

## 4. Docker & Infrastructure

### `docker-compose.yml`

```yaml
version: "3.9"

services:
  db:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB:       ${POSTGRES_DB}
      POSTGRES_USER:     ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"        # expose for local debugging; close in prod
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build: .
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    env_file: .env
    ports:
      - "8000:8000"
    volumes:
      - ./app:/app/app        # hot reload in dev
    command: >
      uvicorn app.main:app
      --host 0.0.0.0
      --port 8000
      --reload                # remove --reload in production

volumes:
  postgres_data:
```

### `Dockerfile`

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system deps for psycopg2
RUN apt-get update && apt-get install -y \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run Alembic migrations, then start server
CMD alembic upgrade head && \
    uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### `.env.example`

```env
# PostgreSQL
POSTGRES_DB=productivity
POSTGRES_USER=produser
POSTGRES_PASSWORD=change_this_strong_password
DATABASE_URL=postgresql+asyncpg://produser:change_this_strong_password@db:5432/productivity

# API Auth (must match Android app's BuildConfig.API_SECRET_KEY)
API_SECRET_KEY=generate_with_python3_secrets_token_hex_32

# Google AI Studio
GOOGLE_AI_STUDIO_API_KEY=get_from_aistudio_google_com

# Economy defaults (can be overridden via /settings endpoint)
DEFAULT_HOURLY_EARN_RATE=100
DEFAULT_DAILY_TARGET_HOURS=3.0
DEFAULT_LAZY_TAX=100
DEFAULT_STEP_INCOME_CAP=50
DEFAULT_LOAN_INTEREST_RATE=0.05

# Environment
ENVIRONMENT=development    # or "production"
```

### `requirements.txt`

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
sqlalchemy[asyncio]==2.0.30
asyncpg==0.29.0
alembic==1.13.1
pydantic==2.7.1
pydantic-settings==2.2.1
httpx==0.27.0
apscheduler==3.10.4
python-dotenv==1.0.1
```

---

## 5. Configuration (`app/config.py`)

```python
from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # Database
    database_url: str

    # Auth
    api_secret_key: str

    # Google AI Studio
    google_ai_studio_api_key: str

    # Economy defaults
    default_hourly_earn_rate: int = 100
    default_daily_target_hours: float = 3.0
    default_lazy_tax: int = 100
    default_step_income_cap: int = 50
    default_loan_interest_rate: float = 0.05

    environment: str = "development"

    class Config:
        env_file = ".env"

@lru_cache
def get_settings() -> Settings:
    return Settings()
```

---

## 6. Database Setup (`app/database.py`)

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=settings.environment == "development",
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

class Base(DeclarativeBase):
    pass

# Dependency — inject into route handlers
async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

---

## 7. Database Models

### `app/models/ledger.py`

This is the most critical model. The balance is NEVER stored — it is always computed as `SUM(amount)`.

```python
import enum
from sqlalchemy import BigInteger, Integer, String, Boolean, Enum, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time

class LedgerCategory(str, enum.Enum):
    NFC           = "NFC"           # earned from desk tag session
    SMS_UPI       = "SMS_UPI"       # UPI debit from SMS channel
    NOTIFICATION_UPI = "NOTIFICATION_UPI"  # UPI debit from notification channel
    DISTRACTION   = "DISTRACTION"   # app usage drain
    OATH_LOAN     = "OATH_LOAN"     # loan credited to wallet
    OATH_INTEREST = "OATH_INTEREST" # compound interest penalty
    LAZY_TAX      = "LAZY_TAX"      # missed daily target
    STEP_INCOME   = "STEP_INCOME"   # walking income
    MANUAL        = "MANUAL"        # manually verified evidence
    BOSS_REWARD   = "BOSS_REWARD"   # boss fight loot drop
    REVERSAL      = "REVERSAL"      # dispute reversal
    SURGE         = "SURGE"         # surge pricing top-up
    MERCY_SPEND   = "MERCY_SPEND"   # unlock tax (bankrupt unlock)

class SpendClass(str, enum.Enum):
    ESSENTIAL      = "ESSENTIAL"
    DISCRETIONARY  = "DISCRETIONARY"
    UNKNOWN        = "UNKNOWN"

class LedgerEntry(Base):
    __tablename__ = "ledger_entries"

    id:               Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    amount:           Mapped[int]   = mapped_column(Integer, nullable=False)
    # RULE: positive = earn, negative = spend/penalty. Never update, only insert.

    category:         Mapped[LedgerCategory] = mapped_column(Enum(LedgerCategory), nullable=False)
    description:      Mapped[str]   = mapped_column(String(500), nullable=False)
    merchant_name:    Mapped[str]   = mapped_column(String(100), nullable=True)
    spend_class:      Mapped[SpendClass] = mapped_column(Enum(SpendClass), nullable=True)
    device_id:        Mapped[str]   = mapped_column(String(100), nullable=True)
    dedup_key:        Mapped[str]   = mapped_column(String(64), nullable=True, unique=True)
    # dedup_key prevents double-insert from Android dual-channel (SMS + notification)

    timestamp_ms:     Mapped[int]   = mapped_column(BigInteger, default=lambda: int(time.time() * 1000))
    is_disputed:      Mapped[bool]  = mapped_column(Boolean, default=False)
    linked_dispute_id: Mapped[int]  = mapped_column(BigInteger, nullable=True)
    is_verified_by_ai: Mapped[bool] = mapped_column(Boolean, default=False)
    raw_payload:      Mapped[str]   = mapped_column(String(1000), nullable=True)
    # raw_payload stores the full Android event JSON for audit trail

    __table_args__ = (
        Index("idx_ledger_timestamp", "timestamp_ms"),
        Index("idx_ledger_category", "category"),
        Index("idx_ledger_disputed", "is_disputed"),
    )
```

### `app/models/oath.py`

```python
import enum
from sqlalchemy import BigInteger, Integer, Float, String, Enum
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
import time

class OathStatus(str, enum.Enum):
    ACTIVE         = "ACTIVE"
    REPAID_EARLY   = "REPAID_EARLY"
    REPAID_ON_TIME = "REPAID_ON_TIME"
    DEFAULTED      = "DEFAULTED"

class Oath(Base):
    __tablename__ = "oaths"

    id:                   Mapped[int]   = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    initial_loan_amount:  Mapped[int]   = mapped_column(Integer, nullable=False)
    current_debt_amount:  Mapped[int]   = mapped_column(Integer, nullable=False)
    task_description:     Mapped[str]   = mapped_column(String(500), nullable=False)
    due_date_ms:          Mapped[int]   = mapped_column(BigInteger, nullable=False)
    daily_interest_rate:  Mapped[float] = mapped_column(Float, default=0.05)
    status:               Mapped[OathStatus] = mapped_column(Enum(OathStatus), default=OathStatus.ACTIVE)
    created_at_ms:        Mapped[int]   = mapped_column(BigInteger, default=lambda: int(time.time() * 1000))
    repaid_at_ms:         Mapped[int]   = mapped_column(BigInteger, nullable=True)
    credit_score_delta:   Mapped[int]   = mapped_column(Integer, default=0)
    # credit_score_delta is filled on resolution: +50 early, +20 on-time, -100 default
```

### `app/models/session.py`

```python
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
```

### `app/models/stats.py`

```python
from sqlalchemy import BigInteger, Integer, Float, String, Boolean, Date
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

class Settings(Base):
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
```

### `app/models/rules.py`

```python
from sqlalchemy import BigInteger, Integer, Float, String, Boolean, Enum
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
```

---

## 8. Pydantic Schemas (`app/schemas/events.py`)

These mirror exactly what the Android thin client sends.

```python
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
```

---

## 9. Auth Middleware (`app/middleware/auth.py`)

```python
from fastapi import Request, HTTPException
from fastapi.security import APIKeyHeader
from app.config import get_settings

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def verify_api_key(request: Request) -> None:
    """
    FastAPI dependency — attach to any router with:
        router = APIRouter(dependencies=[Depends(verify_api_key)])
    """
    key = request.headers.get("X-API-Key")
    if not key or key != get_settings().api_secret_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
```

---

## 10. Core Service — Ledger (`app/services/ledger_service.py`)

All economy side effects ultimately call `insert_entry()`. Balance is always computed, never stored.

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models.ledger import LedgerEntry, LedgerCategory, SpendClass
from app.schemas.events import UpiDebitPayload
import time

async def insert_entry(
    db: AsyncSession,
    amount: int,
    category: LedgerCategory,
    description: str,
    merchant_name: str | None = None,
    spend_class: SpendClass | None = None,
    dedup_key: str | None = None,
    device_id: str | None = None,
    is_verified_by_ai: bool = False,
    raw_payload: str | None = None,
) -> LedgerEntry:
    entry = LedgerEntry(
        amount=amount,
        category=category,
        description=description,
        merchant_name=merchant_name,
        spend_class=spend_class,
        dedup_key=dedup_key,
        device_id=device_id,
        is_verified_by_ai=is_verified_by_ai,
        raw_payload=raw_payload,
        timestamp_ms=int(time.time() * 1000),
    )
    db.add(entry)
    await db.flush()   # get the ID without committing
    return entry

async def get_balance(db: AsyncSession) -> int:
    """
    THE canonical balance computation.
    Excludes disputed entries (they are suspended pending resolution).
    Balance CAN be negative — that is the bankrupt state.
    """
    result = await db.execute(
        select(func.coalesce(func.sum(LedgerEntry.amount), 0))
        .where(LedgerEntry.is_disputed == False)
    )
    return result.scalar_one()

async def check_dedup(db: AsyncSession, dedup_key: str) -> bool:
    """Returns True if this dedup_key already exists — skip insertion."""
    result = await db.execute(
        select(LedgerEntry.id).where(LedgerEntry.dedup_key == dedup_key).limit(1)
    )
    return result.scalar_one_or_none() is not None

async def get_entries(
    db: AsyncSession,
    limit: int = 50,
    offset: int = 0,
    category: LedgerCategory | None = None,
    date_from_ms: int | None = None,
    date_to_ms: int | None = None,
) -> list[LedgerEntry]:
    filters = [LedgerEntry.is_disputed == False]
    if category:
        filters.append(LedgerEntry.category == category)
    if date_from_ms:
        filters.append(LedgerEntry.timestamp_ms >= date_from_ms)
    if date_to_ms:
        filters.append(LedgerEntry.timestamp_ms <= date_to_ms)

    result = await db.execute(
        select(LedgerEntry)
        .where(and_(*filters))
        .order_by(LedgerEntry.timestamp_ms.desc())
        .limit(limit)
        .offset(offset)
    )
    return result.scalars().all()
```

---

## 11. AI Service (`app/services/ai_service.py`)

Calls Google AI Studio (Gemini 1.5 Flash). Two functions: classify a UPI transaction, validate an evidence photo.

```python
import httpx
import json
import base64
from app.config import get_settings

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"

async def classify_transaction(
    merchant_name: str | None,
    amount: int,
    raw_text: str,
) -> tuple[str, bool]:
    """
    Returns (spend_class, is_ai_verified).
    spend_class: "ESSENTIAL" | "DISCRETIONARY" | "UNKNOWN"

    Fast-path keyword check first — AI only called for ambiguous merchants.
    This avoids API calls for obvious cases (Swiggy = DISCRETIONARY, etc.)
    """
    # ── Fast path — keyword lookup (handles ~80% of Indian transactions) ──
    essential_keywords = [
        "grocer", "medic", "pharma", "hospital", "electricity",
        "water", "rent", "transport", "metro", "ola", "rapido",
        "uber", "namma metro", "bescom", "bwssb"
    ]
    discretionary_keywords = [
        "swiggy", "zomato", "blinkit", "zepto", "amazon", "flipkart",
        "myntra", "netflix", "spotify", "prime", "hotstar", "instagram",
        "bigbasket"   # online grocery delivery = discretionary
    ]
    if merchant_name:
        lower = merchant_name.lower()
        if any(k in lower for k in essential_keywords):
            return "ESSENTIAL", True
        if any(k in lower for k in discretionary_keywords):
            return "DISCRETIONARY", True

    # ── Slow path — call Gemini for ambiguous merchant ──
    prompt = f"""Classify this UPI payment. Respond ONLY with valid JSON, no markdown:
{{"class": "ESSENTIAL" or "DISCRETIONARY", "confidence": 0.0-1.0}}

Merchant: {merchant_name or "Unknown"}
Amount: ₹{amount}
Transaction note: {raw_text[:200]}

Essential = groceries at physical store, medicine, rent, electricity/water bill, local transport fares.
Discretionary = food delivery apps, online shopping, entertainment subscriptions, restaurants."""

    settings = get_settings()
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            f"{GEMINI_API_URL}?key={settings.google_ai_studio_api_key}",
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 50}
            }
        )
        if response.status_code != 200:
            return "UNKNOWN", False

        try:
            raw = response.json()
            text = raw["candidates"][0]["content"]["parts"][0]["text"]
            parsed = json.loads(text.strip())
            return parsed.get("class", "UNKNOWN"), True
        except Exception:
            return "UNKNOWN", False


async def validate_evidence(
    claim_description: str,
    subject: str,
    claimed_amount: int,
    hourly_rate: int,
    image_base64: str,
    past_sessions_today: list[str],
) -> dict:
    """
    Validates a manual evidence photo submission.
    Returns: {"verified": bool, "approved_amount": int, "reasoning": str, "confidence": float}
    """
    sessions_text = "\n".join(f"- {s}" for s in past_sessions_today) or "None yet today"
    claimed_hours = claimed_amount / hourly_rate if hourly_rate > 0 else 0

    prompt = f"""You are a strict but fair productivity auditor.

USER'S CLAIM: "{claim_description}"
SUBJECT: {subject}
CLAIMED HOURS: {claimed_hours:.1f} hours
CLAIMED EARNING: ₹{claimed_amount}
HOURLY RATE: ₹{hourly_rate}/hr

PAST SESSIONS TODAY:
{sessions_text}

Analyse the attached photo carefully. Look for:
- Open textbooks, notes, or printed material relevant to the subject
- IDE or code editor with relevant content visible
- Lecture slides or study material on screen
- Handwritten notes matching the claimed subject

Check for obvious cheating: blank screen, phone wallpaper, unrelated content, hands covering screen.
Award partial credit if the image partially supports the claim.

Respond ONLY with valid JSON, no markdown, no preamble:
{{"verified": true or false, "confidence": 0.0-1.0, "approved_amount": integer, "reasoning": "one sentence"}}"""

    settings = get_settings()
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{GEMINI_API_URL}?key={settings.google_ai_studio_api_key}",
            json={
                "contents": [{
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {"mime_type": "image/jpeg", "data": image_base64}}
                    ]
                }],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": 100}
            }
        )
        if response.status_code != 200:
            return {"verified": False, "approved_amount": 0,
                    "reasoning": "AI service unavailable", "confidence": 0.0}

        try:
            raw = response.json()
            text = raw["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text.strip())
        except Exception:
            return {"verified": False, "approved_amount": 0,
                    "reasoning": "Could not parse AI response", "confidence": 0.0}
```

---

## 12. Event Routers (`app/routers/events.py`)

This is the primary interface for the Android thin client. Every POST here is an event from the phone.

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.schemas.events import EventEnvelope, UpiDebitPayload, NfcSessionPayload
from app.schemas.events import UsageReportPayload, StepsPayload, HeartbeatPayload
from app.services import ledger_service, economy_service, ai_service
from app.models.ledger import LedgerCategory, SpendClass
from app.models.session import NfcSession
from app.models.device import DeviceHeartbeat
import json, time

router = APIRouter(prefix="/events", dependencies=[Depends(verify_api_key)])

# ── POST /events/upi ──────────────────────────────────────────────────────────
@router.post("/upi")
async def receive_upi_debit(envelope: EventEnvelope, db: AsyncSession = Depends(get_db)):
    payload = UpiDebitPayload(**envelope.payload)

    # 1. Deduplication — reject if we've seen this dedup_key before
    if await ledger_service.check_dedup(db, payload.dedup_key):
        return {"status": "duplicate", "message": "Transaction already recorded"}

    # 2. AI classification — essential vs discretionary
    spend_class_str, ai_verified = await ai_service.classify_transaction(
        merchant_name=payload.merchant_name,
        amount=payload.amount_rupees,
        raw_text=payload.raw_text,
    )
    spend_class = SpendClass(spend_class_str)

    # 3. Penalty multiplier — essential = free, discretionary = full cost, unknown = half
    multiplier = {"ESSENTIAL": 0.0, "DISCRETIONARY": 1.0, "UNKNOWN": 0.5}[spend_class_str]
    virtual_cost = int(payload.amount_rupees * multiplier)

    if virtual_cost == 0:
        desc = f"Essential spend at {payload.merchant_name or 'merchant'} — no virtual penalty"
        amount = 0
    else:
        desc = f"UPI: {payload.merchant_name or 'Payment'} — ₹{payload.amount_rupees} real"
        amount = -virtual_cost

    # 4. Insert ledger entry (only if there's a cost)
    if amount != 0:
        await ledger_service.insert_entry(
            db=db,
            amount=amount,
            category=LedgerCategory(f"{payload.source.value}_UPI"
                                    if hasattr(LedgerCategory, f"{payload.source.value}_UPI")
                                    else "SMS_UPI"),
            description=desc,
            merchant_name=payload.merchant_name,
            spend_class=spend_class,
            dedup_key=payload.dedup_key,
            device_id=envelope.device_id,
            is_verified_by_ai=ai_verified,
            raw_payload=json.dumps(envelope.payload)[:500],
        )

    # 5. Compute new balance and build push notification
    balance = await ledger_service.get_balance(db)
    notification = None

    if balance < 0:
        notification = {
            "title": "⚠ You're bankrupt!",
            "body": f"Debt: ₹{abs(balance)}. Tap your desk tag to work it off.",
            "priority": "bankrupt"
        }
    elif amount != 0:
        notification = {
            "title": f"₹{payload.amount_rupees} spent at {payload.merchant_name or 'merchant'}",
            "body": f"Virtual cost: ₹{abs(amount)} ({spend_class_str}). Balance: ₹{balance}",
            "priority": "default"
        }

    return {"status": "ok", "balance": balance, "notification": notification}


# ── POST /events/nfc ──────────────────────────────────────────────────────────
@router.post("/nfc")
async def receive_nfc_tap(envelope: EventEnvelope, db: AsyncSession = Depends(get_db)):
    """
    NFC tap is stateless on Android — the server decides START vs STOP
    based on whether there's an open session for this tag_id + device_id.
    """
    from sqlalchemy import select, and_
    payload = NfcSessionPayload(**envelope.payload)

    # Check for open session
    result = await db.execute(
        select(NfcSession).where(
            and_(
                NfcSession.tag_id == payload.tag_id,
                NfcSession.device_id == envelope.device_id,
                NfcSession.is_open == True,
            )
        ).limit(1)
    )
    open_session = result.scalar_one_or_none()

    if open_session is None:
        # ── START new session ──
        session = NfcSession(
            tag_id=payload.tag_id,
            tag_label=payload.tag_label,
            device_id=envelope.device_id,
            start_ms=envelope.timestamp_ms,
            is_open=True,
        )
        db.add(session)
        await db.flush()

        return {
            "status": "ok",
            "action": "session_started",
            "session_id": session.id,
            "notification": {
                "title": f"🎯 Focus session started",
                "body": f"Tag: {payload.tag_label}. Tap again to stop and earn.",
                "priority": "default"
            }
        }
    else:
        # ── STOP session — compute earnings ──
        end_ms    = envelope.timestamp_ms
        elapsed   = end_ms - open_session.start_ms
        minutes   = elapsed / 60_000

        # Minimum session: 5 minutes
        if minutes < 5:
            open_session.is_open = False
            return {
                "status": "ok",
                "action": "session_too_short",
                "notification": {
                    "title": "Session too short",
                    "body": "Minimum 5 minutes needed to earn. Keep going!",
                    "priority": "default"
                }
            }

        # Get current streak multiplier from daily_stats
        multiplier = await economy_service.get_current_multiplier(db)
        settings   = await economy_service.get_settings(db)
        hourly     = settings.hourly_earn_rate
        base       = int((minutes / 60) * hourly)
        final      = int(base * multiplier)

        # Update session record
        open_session.end_ms          = end_ms
        open_session.duration_minutes = minutes
        open_session.base_earned     = base
        open_session.multiplier      = multiplier
        open_session.final_earned    = final
        open_session.is_open         = False

        # Insert ledger entry
        entry = await ledger_service.insert_entry(
            db=db,
            amount=final,
            category=LedgerCategory.NFC,
            description=f"Focus session: {int(minutes//60)}h {int(minutes%60)}m ({payload.tag_label})",
            device_id=envelope.device_id,
        )
        open_session.ledger_entry_id = entry.id

        # Update today's daily stats
        await economy_service.add_work_minutes(db, int(minutes))

        balance = await ledger_service.get_balance(db)
        return {
            "status": "ok",
            "action": "session_stopped",
            "earned": final,
            "duration_minutes": round(minutes, 1),
            "multiplier": multiplier,
            "notification": {
                "title": f"✅ Session complete! Earned ₹{final}",
                "body": f"{int(minutes)}min × ₹{hourly}/hr × {multiplier}× = ₹{final}. Balance: ₹{balance}",
                "priority": "default"
            }
        }


# ── POST /events/usage ────────────────────────────────────────────────────────
@router.post("/usage")
async def receive_usage_report(envelope: EventEnvelope, db: AsyncSession = Depends(get_db)):
    """
    Receives app usage report from Android (every 30 min).
    Stores raw data — distraction drain is applied during midnight audit,
    not in real-time, to avoid charging the user mid-scroll.
    """
    from app.models.usage import UsageSnapshot
    payload = UsageReportPayload(**envelope.payload)

    snapshot = UsageSnapshot(
        device_id=envelope.device_id,
        period_start_ms=payload.period_start_ms,
        period_end_ms=payload.period_end_ms,
        app_usages_json=json.dumps([u.dict() for u in payload.app_usages]),
        processed=False,
    )
    db.add(snapshot)
    return {"status": "ok", "message": "Usage data received"}


# ── POST /events/steps ────────────────────────────────────────────────────────
@router.post("/steps")
async def receive_steps(envelope: EventEnvelope, db: AsyncSession = Depends(get_db)):
    payload = StepsPayload(**envelope.payload)

    # Check if today's step income was already credited
    today_stats = await economy_service.get_or_create_daily_stats(db)
    if today_stats.step_income_credited:
        return {"status": "ok", "message": "Step income already credited today"}

    # Tiered step income
    settings = await economy_service.get_settings(db)
    cap = settings.step_income_cap
    earned = 0
    if payload.steps_today >= 10_000:  earned = cap
    elif payload.steps_today >= 8_000: earned = int(cap * 0.8)
    elif payload.steps_today >= 5_000: earned = int(cap * 0.5)

    if earned > 0:
        await ledger_service.insert_entry(
            db=db,
            amount=earned,
            category=LedgerCategory.STEP_INCOME,
            description=f"{payload.steps_today:,} steps today",
            device_id=envelope.device_id,
        )
        today_stats.step_income_credited = True

    balance = await ledger_service.get_balance(db)
    return {"status": "ok", "earned": earned, "balance": balance}


# ── POST /events/heartbeat ────────────────────────────────────────────────────
@router.post("/heartbeat")
async def receive_heartbeat(envelope: EventEnvelope, db: AsyncSession = Depends(get_db)):
    """
    15-minute ping from Android service. Used to:
    - Confirm device is alive
    - Push back current balance + any pending notifications
    """
    from app.models.device import DeviceHeartbeat
    payload = HeartbeatPayload(**envelope.payload)

    # Upsert heartbeat record
    from sqlalchemy import select
    result = await db.execute(
        select(DeviceHeartbeat).where(DeviceHeartbeat.device_id == envelope.device_id)
    )
    heartbeat = result.scalar_one_or_none()
    if heartbeat is None:
        heartbeat = DeviceHeartbeat(device_id=envelope.device_id)
        db.add(heartbeat)

    heartbeat.last_seen_ms = envelope.timestamp_ms
    heartbeat.battery_pct  = payload.battery_pct
    heartbeat.is_charging  = payload.is_charging

    balance = await ledger_service.get_balance(db)
    today   = await economy_service.get_or_create_daily_stats(db)

    notification = None
    if balance < 0:
        notification = {
            "title": f"⚠ Bankrupt — ₹{abs(balance)} debt",
            "body": "Tap your desk tag to work it off.",
            "priority": "bankrupt"
        }

    return {
        "status": "ok",
        "balance": balance,
        "streak": today.streak_count,
        "multiplier": today.earning_multiplier,
        "notification": notification
    }
```

---

## 13. Economy Service (`app/services/economy_service.py`)

All streak, multiplier, and settings logic lives here.

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.stats import DailyStats, Settings
from app.models.ledger import LedgerEntry, LedgerCategory
import datetime

async def get_settings(db: AsyncSession) -> Settings:
    result = await db.execute(select(Settings).where(Settings.id == 1))
    settings = result.scalar_one_or_none()
    if settings is None:
        # Create default settings on first run
        settings = Settings(id=1)
        db.add(settings)
        await db.flush()
    return settings

async def get_or_create_daily_stats(db: AsyncSession) -> DailyStats:
    today = datetime.date.today()
    result = await db.execute(select(DailyStats).where(DailyStats.date == today))
    stats = result.scalar_one_or_none()

    if stats is None:
        # Inherit streak + credit score from yesterday
        yesterday = today - datetime.timedelta(days=1)
        result2 = await db.execute(select(DailyStats).where(DailyStats.date == yesterday))
        prev = result2.scalar_one_or_none()

        stats = DailyStats(
            date=today,
            streak_count=prev.streak_count if prev else 0,
            earning_multiplier=prev.earning_multiplier if prev else 1.0,
            credit_score=prev.credit_score if prev else 600,
            mercy_tokens=prev.mercy_tokens if prev else 1,
        )
        db.add(stats)
        await db.flush()
    return stats

async def get_current_multiplier(db: AsyncSession) -> float:
    stats = await get_or_create_daily_stats(db)
    return stats.earning_multiplier

def compute_multiplier(streak_days: int) -> float:
    """
    Streak multiplier scale:
    0 days  → 1.0×
    3 days  → 1.2×
    5 days  → 1.5×
    7+ days → 2.0×
    """
    if streak_days >= 7:  return 2.0
    if streak_days >= 5:  return 1.5
    if streak_days >= 3:  return 1.2
    return 1.0

async def add_work_minutes(db: AsyncSession, minutes: int) -> None:
    stats = await get_or_create_daily_stats(db)
    stats.minutes_worked += minutes

async def credit_score_for_tier(score: int) -> dict:
    """Returns loan terms based on credit score tier."""
    if score >= 800:
        return {"tier": "PLATINUM", "interest_rate": 0.02, "max_days": 30}
    elif score >= 600:
        return {"tier": "GOLD",     "interest_rate": 0.035, "max_days": 21}
    elif score >= 400:
        return {"tier": "SILVER",   "interest_rate": 0.05,  "max_days": 14}
    else:
        return {"tier": "DEFAULTER","interest_rate": 0.08,  "max_days": 7}
```

---

## 14. Midnight Audit (`app/services/audit_service.py`)

This is the nightly cron job. It runs at midnight and is the only place where lazy tax, streak resets, and oath interest are applied. Nothing else should apply these — keeping all scheduled economy logic in one place makes it easy to debug.

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.models.stats import DailyStats
from app.models.oath import Oath, OathStatus
from app.models.ledger import LedgerCategory
from app.services import ledger_service, economy_service
from app.database import AsyncSessionLocal
import datetime
import logging

logger = logging.getLogger("audit")

async def run_midnight_audit():
    """
    Called by APScheduler at 00:00 every day.
    Creates its own DB session — does not depend on a request context.
    """
    async with AsyncSessionLocal() as db:
        try:
            await _audit(db)
            await db.commit()
            logger.info("Midnight audit completed successfully")
        except Exception as e:
            await db.rollback()
            logger.error(f"Midnight audit failed: {e}")

async def _audit(db: AsyncSession):
    today     = datetime.date.today()
    yesterday = today - datetime.timedelta(days=1)
    settings  = await economy_service.get_settings(db)

    # Get yesterday's stats (the day we are auditing)
    result = await db.execute(select(DailyStats).where(DailyStats.date == yesterday))
    yesterday_stats = result.scalar_one_or_none()

    # ── 1. Distraction drain ─────────────────────────────────────────────────
    await _apply_distraction_drain(db, yesterday)

    # ── 2. Streak evaluation ─────────────────────────────────────────────────
    today_stats = await economy_service.get_or_create_daily_stats(db)

    if yesterday_stats:
        target_minutes = settings.daily_target_hours * 60
        threshold      = settings.lazy_tax_threshold_pct  # default 0.5 (50%)
        completion     = yesterday_stats.minutes_worked / target_minutes if target_minutes > 0 else 0

        if completion >= 1.0:
            # Full day — increment streak, boost multiplier
            new_streak = yesterday_stats.streak_count + 1
            today_stats.streak_count       = new_streak
            today_stats.earning_multiplier = economy_service.compute_multiplier(new_streak)
            yesterday_stats.target_hit     = True
            logger.info(f"Streak: {new_streak} days, multiplier: {today_stats.earning_multiplier}×")

        elif completion >= threshold:
            # Partial day — hold streak, don't grow multiplier
            today_stats.streak_count       = yesterday_stats.streak_count
            today_stats.earning_multiplier = yesterday_stats.earning_multiplier

        else:
            # Missed day — check mercy tokens
            if yesterday_stats.mercy_tokens > 0:
                yesterday_stats.mercy_tokens -= 1
                today_stats.streak_count       = yesterday_stats.streak_count  # streak saved
                today_stats.earning_multiplier = yesterday_stats.earning_multiplier
                logger.info(f"Mercy token used — streak saved at {today_stats.streak_count}")
            else:
                # Hard reset
                today_stats.streak_count       = 0
                today_stats.earning_multiplier = 1.0
                yesterday_stats.lazy_tax_applied = True

                await ledger_service.insert_entry(
                    db=db,
                    amount=-settings.lazy_tax_amount,
                    category=LedgerCategory.LAZY_TAX,
                    description=f"Lazy tax — {int(completion*100)}% of daily target completed",
                )
                logger.info(f"Lazy tax applied: ₹{settings.lazy_tax_amount}")

        # Carry mercy tokens forward
        if today_stats.mercy_tokens == 0:
            today_stats.mercy_tokens = yesterday_stats.mercy_tokens

    # ── 3. Monthly mercy token grant (1 per month) ───────────────────────────
    if today.day == 1:
        today_stats.mercy_tokens = min(today_stats.mercy_tokens + 1, 3)
        logger.info("Monthly mercy token granted")

    # ── 4. Oath compound interest ────────────────────────────────────────────
    now_ms = int(datetime.datetime.now().timestamp() * 1000)
    result = await db.execute(
        select(Oath).where(
            and_(
                Oath.status == OathStatus.ACTIVE,
                Oath.due_date_ms < now_ms  # only overdue oaths
            )
        )
    )
    overdue_oaths = result.scalars().all()

    for oath in overdue_oaths:
        interest = int(oath.current_debt_amount * oath.daily_interest_rate)
        oath.current_debt_amount += interest

        await ledger_service.insert_entry(
            db=db,
            amount=-interest,
            category=LedgerCategory.OATH_INTEREST,
            description=f"Overdue interest on Oath #{oath.id}: {oath.task_description[:50]}",
        )
        logger.info(f"Oath #{oath.id} interest: ₹{interest}")

    # ── 5. Monthly spending cap reset ────────────────────────────────────────
    if today.day == 1:
        from app.models.rules import SpendingCap
        from sqlalchemy import update
        await db.execute(update(SpendingCap).values(current_month_spent=0))
        logger.info("Monthly spending caps reset")


async def _apply_distraction_drain(db: AsyncSession, date: datetime.date):
    """
    Process all unprocessed usage snapshots for the given date
    and insert distraction drain ledger entries.
    """
    from app.models.usage import UsageSnapshot
    from app.models.rules import DistractionRule
    import json
    import datetime as dt

    # Get unprocessed snapshots for yesterday
    day_start = int(dt.datetime.combine(date, dt.time.min).timestamp() * 1000)
    day_end   = int(dt.datetime.combine(date, dt.time.max).timestamp() * 1000)

    result = await db.execute(
        select(UsageSnapshot).where(
            and_(
                UsageSnapshot.period_start_ms >= day_start,
                UsageSnapshot.period_end_ms   <= day_end,
                UsageSnapshot.processed       == False,
            )
        )
    )
    snapshots = result.scalars().all()

    # Aggregate minutes per package across all snapshots for the day
    totals: dict[str, int] = {}
    for snap in snapshots:
        usages = json.loads(snap.app_usages_json)
        for usage in usages:
            pkg = usage["package_name"]
            totals[pkg] = totals.get(pkg, 0) + usage["minutes_used"]
        snap.processed = True

    if not totals:
        return

    # Get all distraction rules
    rules_result = await db.execute(select(DistractionRule))
    rules = {r.package_name: r for r in rules_result.scalars().all()}
    settings = await economy_service.get_settings(db)

    for pkg, minutes in totals.items():
        rule = rules.get(pkg)
        if not rule or minutes == 0:
            continue

        # Determine if surge pricing applies (simplified: average over study hours)
        # Full implementation checks per-minute but batch is fine for daily audit
        effective_cost = rule.surge_cost_per_minute if rule.is_surge_enabled else rule.cost_per_minute
        penalty = minutes * effective_cost

        if penalty > 0:
            await ledger_service.insert_entry(
                db=db,
                amount=-penalty,
                category=LedgerCategory.DISTRACTION,
                description=f"{minutes}min on {rule.app_label} (₹{effective_cost}/min)",
                merchant_name=rule.app_label,
            )
```

---

## 15. Scheduler Setup (`app/main.py`)

```python
from fastapi import FastAPI
from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from app.services.audit_service import run_midnight_audit
from app.routers import events, ledger, dashboard, sessions, oaths, settings, usage, health
from app.middleware.auth import verify_api_key

scheduler = AsyncIOScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──
    # Run DB migrations (handled by Dockerfile CMD, but add a check here)
    scheduler.add_job(
        run_midnight_audit,
        CronTrigger(hour=0, minute=0),   # every midnight
        id="midnight_audit",
        replace_existing=True,
        misfire_grace_time=3600,          # if server was down, run within 1hr of midnight
    )
    scheduler.start()
    yield
    # ── Shutdown ──
    scheduler.shutdown()

app = FastAPI(
    title="Productivity Economy API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",      # Swagger UI — useful during development
    redoc_url="/redoc",
)

# All event routes (Android → server)
app.include_router(events.router)

# All frontend routes (React dashboard → server)
app.include_router(ledger.router,    prefix="/ledger")
app.include_router(dashboard.router, prefix="/dashboard")
app.include_router(sessions.router,  prefix="/sessions")
app.include_router(oaths.router,     prefix="/oaths")
app.include_router(settings.router,  prefix="/settings")
app.include_router(usage.router,     prefix="/usage")
app.include_router(health.router)

# CORS — allow the React frontend origin
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173",   # Vite dev server
                   "https://your-frontend-domain.com"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 16. Frontend API Routes (for the React dashboard)

These are the GET routes the React app consumes. Each one aggregates data from the DB.

```python
# GET /dashboard — single call returns everything the Dashboard page needs
{
  "balance": 1240,
  "is_bankrupt": false,
  "earned_today": 300,
  "spent_today": 180,
  "streak": 6,
  "multiplier": 1.5,
  "credit_score": 680,
  "credit_tier": "GOLD",
  "active_oath_count": 1,
  "total_oath_debt": 500,
  "balance_history": [          # last 30 days
    {"date": "2025-05-12", "balance": 800, "earned": 200, "spent": 150},
    ...
  ],
  "todays_activity": [          # last 20 ledger entries today
    {"id": 1, "amount": 200, "category": "NFC", "description": "...", "timestamp_ms": ...},
    ...
  ],
  "monthly_spend_ratio": {"spent": 1240, "budget": 3000}
}

# GET /ledger?limit=20&offset=0&category=NFC&date_from=...&date_to=...
# Returns paginated ledger entries + total count

# GET /sessions?limit=20&offset=0
# Returns NFC session history

# GET /oaths — all oaths (active + historical)
# POST /oaths — create new oath (body: {task_description, loan_amount, due_date_ms})
# PATCH /oaths/{id}/repay — repay an oath, updates credit score

# GET /settings — returns the Settings singleton row
# PATCH /settings — partial update, e.g. {"hourly_earn_rate": 150}

# GET /usage/today — today's app usage breakdown
# GET /usage/rules — all DistractionRule rows
# PATCH /usage/rules/{package_name} — update a rule

# GET /health — returns {"status": "ok", "db": "connected", "ai": "reachable"}
```

---

## 17. Alembic Setup

After all models are defined, run these commands to initialise and create the first migration:

```bash
# Inside the container or your local venv:
alembic init alembic
# Edit alembic/env.py:
#   from app.models import *   ← import all models so Alembic can see them
#   from app.database import Base
#   target_metadata = Base.metadata

alembic revision --autogenerate -m "initial schema"
alembic upgrade head
```

The Dockerfile's CMD already runs `alembic upgrade head` before starting uvicorn, so migrations apply automatically on every container restart.

---

## 18. Deployment Checklist

```bash
# 1. Clone to VPS
git clone ... && cd productivity-backend

# 2. Create .env from example
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, API_SECRET_KEY, GOOGLE_AI_STUDIO_API_KEY

# 3. Start everything
docker compose up -d

# 4. Check logs
docker compose logs -f api

# 5. Verify
curl -H "X-API-Key: your_key" http://localhost:8000/health

# 6. Swagger docs available at:
http://your-vps-ip:8000/docs
```

**Security hardening for production:**
- Put Nginx in front of uvicorn (handles TLS, rate limiting)
- Close port 5432 in docker-compose (Postgres should not be public)
- Set `docs_url=None` in main.py to disable Swagger in production
- Use `ENVIRONMENT=production` to disable SQLAlchemy echo

---

## 19. Key Design Rules — For the Agent to Never Violate

1. **Balance is never stored.** Always `SUM(amount) WHERE is_disputed = False`. If you find yourself writing `balance = X` to a column, stop.

2. **Ledger rows are never updated or deleted.** Corrections = new REVERSAL rows. Disputes = set `is_disputed = True` + later insert REVERSAL.

3. **Midnight audit is the only place** lazy tax, streak resets, and distraction drain ledger entries are inserted. Nothing in the real-time event handlers should insert these.

4. **dedup_key is unique.** The Android dual-channel (SMS + notification) sends the same transaction twice. The `UNIQUE` constraint on `dedup_key` plus the `check_dedup()` function is the only defence. Never remove it.

5. **AI classification is fire-and-forget.** If Google AI Studio is down, classify as `UNKNOWN` (0.5× penalty) and proceed. Never block a UPI event insertion waiting for AI.

6. **All economy config is in the `app_settings` table.** No hardcoded economy values in business logic — always read from `get_settings(db)`.
