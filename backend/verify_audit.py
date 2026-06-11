import asyncio
import datetime
import json
import time
from sqlalchemy import select, delete
from app.database import AsyncSessionLocal
from app.models.ledger import LedgerEntry, LedgerCategory
from app.models.oath import Oath, OathStatus
from app.models.stats import DailyStats
from app.models.rules import DistractionRule, SpendingCap, AppCategory
from app.models.usage import UsageSnapshot
from app.models.bossfight import BossFight, BossFightStatus, LootType
from app.services import audit_service, economy_service, ledger_service

async def test_audit():
    print("=== STARTING MIDNIGHT AUDIT INTEGRATION TESTS ===")
    
    async with AsyncSessionLocal() as db:
        # 0. Clean up previous test runs if any
        # (We use specific dummy titles and package names to avoid deleting real user data)
        await db.execute(delete(UsageSnapshot).where(UsageSnapshot.device_id == "test_audit_device"))
        await db.execute(delete(Oath).where(Oath.task_description.like("Test Audit Oath%")))
        await db.execute(delete(BossFight).where(BossFight.title.like("Test Audit Boss%")))
        
        # Ensure we have distraction rules seeded
        result_rules = await db.execute(select(DistractionRule))
        rules = result_rules.scalars().all()
        if not rules:
            print("Seeding distraction rules...")
            defaults = [
                ("com.instagram.android", "Instagram", AppCategory.SOCIAL, 2, 4),
                ("com.google.android.youtube", "YouTube", AppCategory.ENTERTAINMENT, 1, 2),
            ]
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
            await db.commit()

        # Get settings
        settings = await economy_service.get_settings(db)
        
        # 1. Setup Yesterday and Today dates
        today = datetime.date.today()
        yesterday = today - datetime.timedelta(days=1)
        
        # Setup DailyStats for yesterday
        # We delete yesterday's stats first to start clean
        await db.execute(delete(DailyStats).where(DailyStats.date == yesterday))
        await db.execute(delete(DailyStats).where(DailyStats.date == today))
        await db.commit()
        
        # We start yesterday with:
        # worked: 60 minutes (Target is 3 hours = 180 min, so this is 33.3%, which is below threshold 50%)
        # mercy tokens: 1
        # streak count: 2
        # credit score: 650
        yesterday_stats = DailyStats(
            date=yesterday,
            minutes_worked=60,
            mercy_tokens=1,
            streak_count=2,
            credit_score=650,
            target_hit=False,
            lazy_tax_applied=False
        )
        db.add(yesterday_stats)
        
        # 2. Add App Usage Snapshots for yesterday
        # Let's create two snapshots:
        # Snapshot 1: At 14:00 (Study hours: surge should apply)
        # Snapshot 2: At 23:00 (Outside study hours: surge should not apply)
        snap1_time = datetime.datetime.combine(yesterday, datetime.time(hour=14, minute=0))
        snap1_ms = int(snap1_time.timestamp() * 1000)
        
        snap2_time = datetime.datetime.combine(yesterday, datetime.time(hour=23, minute=0))
        snap2_ms = int(snap2_time.timestamp() * 1000)
        
        usages1 = [
            {"package_name": "com.instagram.android", "minutes_used": 10} # 10 min * 4 = 40 penalty
        ]
        usages2 = [
            {"package_name": "com.instagram.android", "minutes_used": 10} # 10 min * 2 = 20 penalty (no surge)
        ]
        
        snap1 = UsageSnapshot(
            device_id="test_audit_device",
            period_start_ms=snap1_ms,
            period_end_ms=snap1_ms + 15 * 60 * 1000,
            app_usages_json=json.dumps(usages1),
            processed=False
        )
        snap2 = UsageSnapshot(
            device_id="test_audit_device",
            period_start_ms=snap2_ms,
            period_end_ms=snap2_ms + 15 * 60 * 1000,
            app_usages_json=json.dumps(usages2),
            processed=False
        )
        db.add(snap1)
        db.add(snap2)
        
        # 3. Add an overdue Oath for interest compounding
        # Due 2 days ago
        due_ms = int((time.time() - 2 * 86400) * 1000)
        oath = Oath(
            initial_loan_amount=500,
            current_debt_amount=500,
            task_description="Test Audit Oath 1",
            due_date_ms=due_ms,
            daily_interest_rate=0.05,
            status=OathStatus.ACTIVE
        )
        db.add(oath)
        
        # 4. Add an expired Boss Fight to fail
        boss = BossFight(
            title="Test Audit Boss 1",
            target_hours=10.0,
            current_hours=4.0,
            deadline_ms=int((time.time() - 3600) * 1000), # expired 1 hour ago
            status=BossFightStatus.ACTIVE,
            loot_type=LootType.RUPEE_PAYOUT,
            loot_value=500
        )
        db.add(boss)
        
        await db.commit()
        
        # 5. Run the Midnight Audit for yesterday!
        print("Running audit...")
        await audit_service.run_midnight_audit(yesterday)
        
        # 6. Verify assertions
        print("Checking assertions...")
        
        # Reload models from database
        await db.refresh(snap1)
        await db.refresh(snap2)
        await db.refresh(oath)
        await db.refresh(boss)
        
        # A. Snapshots should be processed
        assert snap1.processed is True, "Snapshot 1 should be marked processed"
        assert snap2.processed is True, "Snapshot 2 should be marked processed"
        print("✅ App usage snapshots processed successfully.")
        
        # B. Distraction penalty check
        # We expect one distraction ledger entry for com.instagram.android
        # Total minutes: 20
        # Total penalty: (10 * 4) + (10 * 2) = 60
        result_ledger = await db.execute(
            select(LedgerEntry).where(
                LedgerEntry.category == LedgerCategory.DISTRACTION
            ).order_by(LedgerEntry.id.desc())
        )
        entries = result_ledger.scalars().all()
        assert len(entries) >= 1, "Should have distraction entries"
        latest_distraction = entries[0]
        assert latest_distraction.amount == -60, f"Distraction penalty should be -60, got {latest_distraction.amount}"
        print("✅ Distraction penalty calculation correct (Surge vs Non-Surge).")
        
        # C. Streak saved by Mercy token
        # Yesterday was missed (60 min worked < 180 min target).
        # Mercy token count was 1, so it should be decremented to 0.
        # Streak count should remain 2.
        await db.refresh(yesterday_stats)
        result_today_stats = await db.execute(select(DailyStats).where(DailyStats.date == today))
        today_stats = result_today_stats.scalar_one()
        
        assert yesterday_stats.mercy_tokens == 0, f"Yesterday's mercy tokens should be 0, got {yesterday_stats.mercy_tokens}"
        assert today_stats.streak_count == 2, f"Today's streak should be 2, got {today_stats.streak_count}"
        assert today_stats.mercy_tokens == 0, f"Today's mercy tokens should be 0, got {today_stats.mercy_tokens}"
        print("✅ Streak saved by mercy token verified.")
        
        # D. Overdue oath interest compounding
        # Interest should be 500 * 0.05 = 25
        # Status should become OVERDUE
        assert oath.status == OathStatus.OVERDUE, f"Oath status should be OVERDUE, got {oath.status}"
        assert oath.current_debt_amount == 525, f"Oath debt should compound to 525, got {oath.current_debt_amount}"
        
        # E. Expired boss fight should be FAILED
        assert boss.status == BossFightStatus.FAILED, f"Boss status should be FAILED, got {boss.status}"
        print("✅ Boss fight failure verified.")
        
        # Clean up
        await db.delete(snap1)
        await db.delete(snap2)
        await db.delete(oath)
        await db.delete(boss)
        await db.delete(yesterday_stats)
        await db.delete(today_stats)
        await db.commit()
        print("✅ Cleaned up test database records.")
        
        print("\n=== ALL AUDIT INTEGRATION TESTS PASSED ===")

if __name__ == "__main__":
    asyncio.run(test_audit())
