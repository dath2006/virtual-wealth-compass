from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import json
import datetime as dt
from app.database import get_db
from app.middleware.auth import verify_api_key
from app.models.usage import UsageSnapshot
from app.models.rules import DistractionRule, AppCategory

router = APIRouter(prefix="/usage", dependencies=[Depends(verify_api_key)])

@router.get("/today")
async def get_usage_report_today(db: AsyncSession = Depends(get_db)):
    today = dt.date.today()
    start_of_today_ms = int(dt.datetime.combine(today, dt.time.min).timestamp() * 1000)
    start_of_month_ms = int(dt.datetime.combine(today.replace(day=1), dt.time.min).timestamp() * 1000)
    
    # Query all snapshots for this month
    result_snaps = await db.execute(
        select(UsageSnapshot).where(UsageSnapshot.period_start_ms >= start_of_month_ms)
    )
    snapshots = result_snaps.scalars().all()
    
    # Aggregate minutes
    today_minutes = {}
    month_minutes = {}
    for snap in snapshots:
        is_today = snap.period_start_ms >= start_of_today_ms
        try:
            usages = json.loads(snap.app_usages_json)
            for u in usages:
                pkg = u["package_name"]
                mins = u["minutes_used"]
                if is_today:
                    today_minutes[pkg] = today_minutes.get(pkg, 0) + mins
                month_minutes[pkg] = month_minutes.get(pkg, 0) + mins
        except Exception:
            pass
            
    # Query distraction rules
    result_rules = await db.execute(select(DistractionRule))
    rules = result_rules.scalars().all()
    
    # If rules are empty, seed some default distraction rules
    if not rules:
        defaults = [
            ("com.instagram.android", "Instagram", AppCategory.SOCIAL, 2, 4),
            ("com.google.android.youtube", "YouTube", AppCategory.ENTERTAINMENT, 1, 2),
            ("com.netflix.mediaclient", "Netflix", AppCategory.ENTERTAINMENT, 1, 2),
            ("com.application.zomato", "Zomato", AppCategory.SHOPPING, 3, 6),
            ("com.flipkart.android", "Flipkart", AppCategory.SHOPPING, 3, 6),
        ]
        rules = []
        for pkg, label, cat, cost, surge in defaults:
            rule = DistractionRule(
                package_name=pkg,
                app_label=label,
                category=cat,
                cost_per_minute=cost,
                surge_cost_per_minute=surge,
                monthly_cap_minutes=600,
                is_surge_enabled=True
            )
            db.add(rule)
            rules.append(rule)
        await db.commit()
        
    apps = []
    total_drained_today = 0
    by_category_map = {}
    
    # Initialize byCategory map
    for cat in AppCategory:
        by_category_map[cat.value] = {"category": cat.value, "drained": 0, "minutes": 0}
        
    for rule in rules:
        pkg = rule.package_name
        mins_today = today_minutes.get(pkg, 0)
        mins_month = month_minutes.get(pkg, 0)
        
        # Determine if surge pricing applies
        effective_cost = rule.surge_cost_per_minute if rule.is_surge_enabled else rule.cost_per_minute
        drained_today = mins_today * effective_cost
        
        total_drained_today += drained_today
        
        # Accumulate category totals
        cat_str = rule.category.value
        if cat_str in by_category_map:
            by_category_map[cat_str]["drained"] += drained_today
            by_category_map[cat_str]["minutes"] += mins_today
            
        apps.append({
            "packageName": pkg,
            "appName": rule.app_label,
            "category": rule.category.value,
            "costPerMin": rule.cost_per_minute,
            "surgeCostPerMin": rule.surge_cost_per_minute,
            "monthlyCapMin": rule.monthly_cap_minutes,
            "surgeEnabled": rule.is_surge_enabled,
            "minutesToday": mins_today,
            "minutesThisMonth": mins_month
        })
        
    by_category_list = [v for v in by_category_map.values() if v["minutes"] > 0 or v["drained"] > 0]
    
    return {
        "totalDrainedToday": total_drained_today,
        "apps": apps,
        "byCategory": by_category_list
    }
