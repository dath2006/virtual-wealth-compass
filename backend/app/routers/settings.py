from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, Dict
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.stats import AppSettings
from app.models.rules import SpendingCap, AppCategory, DistractionRule
from app.models.suggestion import RateSuggestion
from app.services import economy_service

router = APIRouter(prefix="/settings", dependencies=[Depends(verify_api_key)])

DAY_MAP_TO_STR = {0: "MON", 1: "TUE", 2: "WED", 3: "THU", 4: "FRI", 5: "SAT", 6: "SUN"}
DAY_MAP_TO_INT = {v: k for k, v in DAY_MAP_TO_STR.items()}

class PatchSettingsRequest(BaseModel):
    hourlyNfcRate: Optional[int] = None
    stepDailyCap: Optional[int] = None
    dailyStudyHours: Optional[float] = None
    lazyTaxAmount: Optional[int] = None
    lazyTaxThresholdPct: Optional[float] = None
    unlockTax: Optional[int] = None
    monthlyDiscretionaryBudget: Optional[int] = None
    defaultDailyInterestPct: Optional[float] = None
    studyHoursStart: Optional[str] = None
    studyHoursEnd: Optional[str] = None
    salaryDay: Optional[str] = None
    categoryCaps: Optional[Dict[str, int]] = None
    apiBaseUrl: Optional[str] = None

@router.get("")
async def get_app_settings(db: AsyncSession = Depends(get_db)):
    settings = await economy_service.get_settings(db)
    
    # Query category caps
    result_caps = await db.execute(select(SpendingCap))
    caps_list = result_caps.scalars().all()
    
    # Defaults if empty
    category_caps = {
        "SOCIAL": 1200,
        "ENTERTAINMENT": 1500,
        "SHOPPING": 800,
        "GAMING": 600
    }
    for c in caps_list:
        category_caps[c.category.value] = c.monthly_cap_rupees
        
    return {
        "hourlyNfcRate": settings.hourly_earn_rate,
        "stepDailyCap": settings.step_income_cap,
        "dailyStudyHours": settings.daily_target_hours,
        "lazyTaxAmount": settings.lazy_tax_amount,
        "lazyTaxThresholdPct": settings.lazy_tax_threshold_pct * 100,
        "unlockTax": settings.unlock_tax_amount,
        "monthlyDiscretionaryBudget": settings.monthly_budget,
        "categoryCaps": category_caps,
        "defaultDailyInterestPct": settings.default_interest_rate * 100,
        "studyHoursStart": f"{settings.study_hours_start:02d}:00",
        "studyHoursEnd": f"{settings.study_hours_end:02d}:00",
        "salaryDay": DAY_MAP_TO_STR.get(settings.salary_day_of_week, "SUN"),
        "apiBaseUrl": "http://localhost:8000" # fallback read dynamically in prod
    }

@router.patch("")
async def update_app_settings(req: PatchSettingsRequest, db: AsyncSession = Depends(get_db)):
    settings = await economy_service.get_settings(db)
    
    if req.hourlyNfcRate is not None:
        settings.hourly_earn_rate = req.hourlyNfcRate
    if req.stepDailyCap is not None:
        settings.step_income_cap = req.stepDailyCap
    if req.dailyStudyHours is not None:
        settings.daily_target_hours = req.dailyStudyHours
    if req.lazyTaxAmount is not None:
        settings.lazy_tax_amount = req.lazyTaxAmount
    if req.lazyTaxThresholdPct is not None:
        settings.lazy_tax_threshold_pct = req.lazyTaxThresholdPct / 100.0
    if req.unlockTax is not None:
        settings.unlock_tax_amount = req.unlockTax
    if req.monthlyDiscretionaryBudget is not None:
        settings.monthly_budget = req.monthlyDiscretionaryBudget
    if req.defaultDailyInterestPct is not None:
        settings.default_interest_rate = req.defaultDailyInterestPct / 100.0
        
    if req.studyHoursStart is not None:
        try:
            hour = int(req.studyHoursStart.split(":")[0])
            settings.study_hours_start = hour
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid studyHoursStart format. Use 'HH:MM'")
            
    if req.studyHoursEnd is not None:
        try:
            hour = int(req.studyHoursEnd.split(":")[0])
            settings.study_hours_end = hour
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid studyHoursEnd format. Use 'HH:MM'")
            
    if req.salaryDay is not None:
        if req.salaryDay in DAY_MAP_TO_INT:
            settings.salary_day_of_week = DAY_MAP_TO_INT[req.salaryDay]
        else:
            raise HTTPException(status_code=400, detail="Invalid salaryDay. Use SUN, MON, etc.")
            
    # Update category spending caps
    if req.categoryCaps is not None:
        for cat_str, limit in req.categoryCaps.items():
            try:
                category_enum = AppCategory(cat_str)
                result_cap = await db.execute(
                    select(SpendingCap).where(SpendingCap.category == category_enum)
                )
                cap = result_cap.scalar_one_or_none()
                if cap is None:
                    cap = SpendingCap(category=category_enum, monthly_cap_rupees=limit)
                    db.add(cap)
                else:
                    cap.monthly_cap_rupees = limit
            except ValueError:
                pass # skip invalid category strings
                
    await db.commit()
    return {"status": "ok"}


# ── AI Rate Suggestions ─────────────────────────────────────────────────────────

@router.get("/suggestions")
async def get_rate_suggestions(db: AsyncSession = Depends(get_db)):
    """Returns pending AI rate suggestions for the Settings page."""
    result = await db.execute(
        select(RateSuggestion)
        .where(RateSuggestion.status == "PENDING")
        .order_by(RateSuggestion.generated_at.desc())
    )
    suggestions = result.scalars().all()
    return [
        {
            "id":              s.id,
            "field":           s.field,
            "target_package":  s.target_package,
            "current_value":   s.current_value,
            "suggested_value": s.suggested_value,
            "reason":          s.reason,
            "impact":          s.impact,
            "status":          s.status,
            "generated_at":    s.generated_at,
        }
        for s in suggestions
    ]


@router.post("/suggestions/{suggestion_id}/apply")
async def apply_suggestion(suggestion_id: int, db: AsyncSession = Depends(get_db)):
    """User clicks Apply on a suggestion. Updates the actual setting or rule."""
    result = await db.execute(
        select(RateSuggestion).where(RateSuggestion.id == suggestion_id)
    )
    s = result.scalar_one_or_none()
    if not s or s.status != "PENDING":
        raise HTTPException(status_code=404, detail="Suggestion not found or already actioned")

    settings = await economy_service.get_settings(db)

    if s.field == "hourly_earn_rate":
        settings.hourly_earn_rate = s.suggested_value
    elif s.field == "lazy_tax_amount":
        settings.lazy_tax_amount = s.suggested_value
    elif s.field == "distraction_cost_per_minute" and s.target_package:
        rule_result = await db.execute(
            select(DistractionRule).where(DistractionRule.package_name == s.target_package)
        )
        rule = rule_result.scalar_one_or_none()
        if rule:
            rule.cost_per_minute = s.suggested_value
    elif s.field == "surge_cost_per_minute" and s.target_package:
        rule_result = await db.execute(
            select(DistractionRule).where(DistractionRule.package_name == s.target_package)
        )
        rule = rule_result.scalar_one_or_none()
        if rule:
            rule.surge_cost_per_minute = s.suggested_value

    s.status = "APPLIED"
    await db.commit()
    return {"status": "applied", "field": s.field, "new_value": s.suggested_value}


@router.post("/suggestions/{suggestion_id}/dismiss")
async def dismiss_suggestion(suggestion_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RateSuggestion).where(RateSuggestion.id == suggestion_id)
    )
    s = result.scalar_one_or_none()
    if s:
        s.status = "DISMISSED"
        await db.commit()
    return {"status": "dismissed"}
