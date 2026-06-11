from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from app.services.audit_service import run_midnight_audit
from app.routers import (
    events, ledger, sessions, oaths, stats, credit, mercy,
    device, settings, usage, bosses, health, marketplace,
    wellness, stream, deductions,
)
from app.routers.marketplace import seed_marketplace
from app.database import AsyncSessionLocal

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──
    async with AsyncSessionLocal() as db:
        await seed_marketplace(db)
        await db.commit()

    scheduler.add_job(
        run_midnight_audit,
        CronTrigger(hour=0, minute=0),   # every midnight
        id="midnight_audit",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        generate_weekly_challenges_job,
        CronTrigger(day_of_week="mon", hour=6, minute=0),  # Every Monday 6 AM
        id="weekly_challenges",
        replace_existing=True,
    )
    scheduler.add_job(
        generate_rate_suggestions_job,
        CronTrigger(day_of_week="sun", hour=20, minute=0),  # Salary Day 8 PM
        id="rate_advisor",
        replace_existing=True,
    )
    scheduler.start()
    yield
    # ── Shutdown ──
    scheduler.shutdown()


app = FastAPI(
    title="Productivity Economy API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# All event routes (Android → server)
app.include_router(events.router)

# All frontend routes (React dashboard → server)
app.include_router(ledger.router)       # handles /ledger and /balance
app.include_router(sessions.router)     # handles /sessions
app.include_router(oaths.router)        # handles /oaths
app.include_router(stats.router)        # handles /stats/daily and /stats/streak
app.include_router(credit.router)       # handles /credit
app.include_router(mercy.router)        # handles /mercy
app.include_router(device.router)       # handles /device
app.include_router(settings.router)     # handles /settings
app.include_router(usage.router)        # handles /usage/today
app.include_router(bosses.router)       # handles /bosses
app.include_router(marketplace.router)  # handles /marketplace
app.include_router(health.router)       # handles /health

# ── Addendum 3 routers ────────────────────────────────────────────────────────
app.include_router(wellness.router)    # handles /wellness/*
app.include_router(stream.router)      # handles /stream (SSE)
app.include_router(deductions.router)  # handles /deductions/*

# CORS — allow the React frontend origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all origins for local development ease, hardening in prod
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Scheduler job functions ───────────────────────────────────────────────────

async def generate_weekly_challenges_job():
    from app.services.achievement_service import generate_weekly_challenges
    async with AsyncSessionLocal() as db:
        await generate_weekly_challenges(db)
        await db.commit()


async def generate_rate_suggestions_job():
    from app.services.rate_advisor import generate_rate_suggestions
    async with AsyncSessionLocal() as db:
        await generate_rate_suggestions(db)
        await db.commit()
