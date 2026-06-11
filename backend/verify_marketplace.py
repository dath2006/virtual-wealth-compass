import asyncio
import datetime
import json
import time
from sqlalchemy import select, delete, and_, func, update
from app.database import AsyncSessionLocal
from app.models.ledger import LedgerEntry, LedgerCategory, SpendClass
from app.models.oath import Oath, OathStatus
from app.models.stats import DailyStats
from app.models.bossfight import BossFight, BossFightStatus, LootType
from app.models.marketplace import MarketplacePass, PurchasedPass, PassStatus, PassType, PassCategory
from app.services import ledger_service, economy_service
from app.routers.marketplace import (
    seed_marketplace,
    purchase_pass,
    activate_pass,
    end_pass_early,
    try_consume_activity_pass,
    get_active_pass_for_heartbeat,
    PurchaseRequest,
)

async def test_marketplace():
    print("=== STARTING LEISURE MARKETPLACE INTEGRATION TESTS ===")
    
    async with AsyncSessionLocal() as db:
        # 0. Clean up previous test runs if any
        # Delete test purchased passes and ledger entries to avoid cluttering actual history
        await db.execute(delete(PurchasedPass).where(PurchasedPass.notes.like("Test %")))
        await db.execute(delete(LedgerEntry).where(LedgerEntry.description.like("Marketplace: %")))
        await db.execute(delete(LedgerEntry).where(LedgerEntry.description.like("Test credit%")))
        await db.execute(delete(LedgerEntry).where(LedgerEntry.description.like("Free Scroll pass%")))
        await db.execute(delete(LedgerEntry).where(LedgerEntry.category == LedgerCategory.DISTRACTION))
        await db.commit()
        
        # Make sure seed data exists
        print("Ensuring marketplace catalogue is seeded...")
        await seed_marketplace(db)
        # Temporarily set cooldown to 0 for NAP to allow back-to-back purchases in tests
        await db.execute(
            update(MarketplacePass)
            .where(MarketplacePass.pass_type == PassType.NAP)
            .values(cooldown_hours_after_use=0)
        )
        await db.commit()
        
        # 1. Establish positive balance for the test user
        print("Setting up test balance of ₹5000...")
        # Get current balance
        initial_balance = await ledger_service.get_balance(db)
        print(f"Initial balance: ₹{initial_balance}")
        
        # Credit user to reach high balance
        credit_amount = 5000 - initial_balance
        if credit_amount > 0:
            await ledger_service.insert_entry(
                db=db,
                amount=credit_amount,
                category=LedgerCategory.NFC,
                description="Test credit: Setup balance"
            )
            await db.commit()
        
        final_setup_balance = await ledger_service.get_balance(db)
        print(f"Set up balance: ₹{final_setup_balance}")
        assert final_setup_balance >= 5000, f"Setup balance should be >= 5000, got {final_setup_balance}"
        
        # 2. Setup today's daily stats for eligibility
        # Ensure we have high work minutes and streak count to bypass minimum checks
        print("Mocking today's stats for eligibility...")
        today = datetime.date.today()
        # Find if today's stats already exist
        today_stats = await economy_service.get_or_create_daily_stats(db)
        today_stats.minutes_worked = 180 # 3 hours
        today_stats.streak_count = 10
        await db.commit()
        
        # 3. Test Purchase of NAP pass (cooldown, valid_after_hour etc do not block NAP activation)
        print("Testing purchase of NAP pass...")
        purchase_req = PurchaseRequest(pass_type=PassType.NAP, notes="Test nap purchase")
        purchased_res = await purchase_pass(purchase_req, db)
        
        pass_id = purchased_res["id"]
        assert purchased_res["status"] == "PURCHASED", f"Expected status PURCHASED, got {purchased_res['status']}"
        assert purchased_res["price_paid"] == 50, f"Expected price paid 50, got {purchased_res['price_paid']}"
        print(f"✅ Pass purchased successfully. ID: {pass_id}")
        
        # Verify from database
        result = await db.execute(select(PurchasedPass).where(PurchasedPass.id == pass_id))
        purch_pass = result.scalar_one()
        assert purch_pass.status == PassStatus.PURCHASED, "Database status should be PURCHASED"
        
        # Verify ledger debit
        new_balance = await ledger_service.get_balance(db)
        assert new_balance == final_setup_balance - 50, f"Expected balance {final_setup_balance - 50}, got {new_balance}"
        print(f"✅ Balance correctly debited to ₹{new_balance}")
        
        # 4. Test Guilt Tax calculation
        print("Testing guilt tax application...")
        # Add a distraction ledger entry today
        await ledger_service.insert_entry(
            db=db,
            amount=-60,
            category=LedgerCategory.DISTRACTION,
            description="App distraction today"
        )
        await db.commit()
        
        # Now purchase a MOVIE pass. Guilt tax for MOVIE is 20% = +₹60 (Total price = ₹360)
        purchase_req2 = PurchaseRequest(pass_type=PassType.MOVIE, notes="Test movie purchase with guilt tax")
        purchased_res2 = await purchase_pass(purchase_req2, db)
        
        pass_id2 = purchased_res2["id"]
        assert purchased_res2["price_paid"] == 360, f"Expected price paid 360 (with guilt tax), got {purchased_res2['price_paid']}"
        assert purchased_res2["guilt_tax"] == 60, f"Expected guilt tax 60, got {purchased_res2['guilt_tax']}"
        print(f"✅ Guilt tax applied and debited successfully. ID: {pass_id2}, Price Paid: {purchased_res2['price_paid']}")
        
        # 5. Test Activation of the first pass
        print("Testing activation of the first NAP pass...")
        active_res = await activate_pass(pass_id, db)
        assert active_res["status"] == "ACTIVE", f"Expected ACTIVE status, got {active_res['status']}"
        assert active_res["duration_minutes"] == 45, f"Expected duration 45 minutes, got {active_res['duration_minutes']}"
        print(f"✅ Pass activated successfully. Expires at: {active_res['expires_at_ms']}")
        
        # Verify in DB
        await db.refresh(purch_pass)
        assert purch_pass.status == PassStatus.ACTIVE, "Database status should be ACTIVE"
        assert purch_pass.expires_at_ms is not None, "Expires at should be set"
        
        # 6. Test Heartbeat Active Pass information
        print("Testing heartbeat integration...")
        hb_pass = await get_active_pass_for_heartbeat(db)
        assert hb_pass is not None, "Active pass should be returned in heartbeat"
        assert hb_pass["pass_id"] == pass_id, f"Expected pass ID {pass_id}, got {hb_pass['pass_id']}"
        assert hb_pass["pass_type"] == "NAP", f"Expected pass type NAP, got {hb_pass['pass_type']}"
        print("✅ Heartbeat active pass info verified.")
        
        # 7. Test Boss Fight Loot Stacking
        print("Testing Boss Fight loot stacking...")
        # Create an unclaimed boss fight scroll reward in ledger
        await ledger_service.insert_entry(
            db=db,
            amount=0,
            category=LedgerCategory.BOSS_REWARD,
            description="Free Scroll pass: 30min — Boss: Dragon King"
        )
        await db.commit()
        
        # Now purchase and activate a new NAP pass (which is stackable)
        purchase_req3 = PurchaseRequest(pass_type=PassType.NAP, notes="Test nap purchase with boss loot")
        purchased_res3 = await purchase_pass(purchase_req3, db)
        pass_id3 = purchased_res3["id"]
        
        active_res3 = await activate_pass(pass_id3, db)
        # NAP base (45) + Boss scroll (30) = 75 minutes
        assert active_res3["duration_minutes"] == 75, f"Expected duration 75 minutes with loot, got {active_res3['duration_minutes']}"
        assert active_res3["loot_bonus_minutes"] == 30, f"Expected 30 min loot bonus, got {active_res3['loot_bonus_minutes']}"
        print(f"✅ Boss fight loot stacked successfully! Total duration: {active_res3['duration_minutes']} minutes.")
        
        # Verify that the boss reward ledger entry was marked consumed
        res_reward = await db.execute(
            select(LedgerEntry).where(
                and_(
                    LedgerEntry.category == LedgerCategory.BOSS_REWARD,
                    LedgerEntry.description.like("Free Scroll pass%")
                )
            )
        )
        reward_entry = res_reward.scalar_one()
        assert reward_entry.linked_dispute_id == -1, f"Loot entry should have linked_dispute_id = -1, got {reward_entry.linked_dispute_id}"
        print("✅ Boss reward ledger entry marked as consumed.")
        
        # 8. Test End Early
        print("Testing ending pass early...")
        end_res = await end_pass_early(pass_id, db)
        assert end_res["status"] == "ok", "Expected end_res status ok"
        await db.refresh(purch_pass)
        assert purch_pass.status == PassStatus.EXPIRED, f"Expected status EXPIRED, got {purch_pass.status}"
        print("✅ Pass ended early successfully.")
        
        # 9. Test UPI Activity Pass consumption
        print("Testing UPI Activity Pass purchase and consumption...")
        # Purchase RESTAURANT pass
        purchase_req_rest = PurchaseRequest(pass_type=PassType.RESTAURANT, notes="Test restaurant purchase")
        purch_rest_res = await purchase_pass(purchase_req_rest, db)
        rest_pass_id = purch_rest_res["id"]
        
        # Activate RESTAURANT pass
        await activate_pass(rest_pass_id, db)
        
        # Verify it is active in DB
        result_rest = await db.execute(select(PurchasedPass).where(PurchasedPass.id == rest_pass_id))
        rest_pass = result_rest.scalar_one()
        assert rest_pass.status == PassStatus.ACTIVE, "Expected status ACTIVE"
        
        # Try to consume it with a restaurant UPI transaction
        consumed = await try_consume_activity_pass(
            db=db,
            merchant_name="Dhaba Junction Cafe",
            amount=450,
            dedup_key="test_upi_marketplace_dedup_1"
        )
        assert consumed is True, "Expected restaurant pass to be consumed by Dhaba transaction under 800"
        
        await db.refresh(rest_pass)
        assert rest_pass.status == PassStatus.CONSUMED, f"Expected status CONSUMED, got {rest_pass.status}"
        assert rest_pass.consumed_at_ms is not None, "Consumed timestamp should be set"
        assert rest_pass.matched_upi_dedup_key == "test_upi_marketplace_dedup_1", "Dedup key match failed"
        print("✅ UPI Activity Pass consumed successfully.")
        
        # Try consuming again, should return False because no active restaurant pass remains
        consumed_again = await try_consume_activity_pass(
            db=db,
            merchant_name="Dhaba Junction Cafe",
            amount=450,
            dedup_key="test_upi_marketplace_dedup_2"
        )
        assert consumed_again is False, "Expected False since restaurant pass is already consumed"
        print("✅ UPI Activity Pass consumption idempotency/limit checked.")
        
        # 10. Clean up test records
        print("Cleaning up test database records...")
        await db.execute(delete(PurchasedPass).where(PurchasedPass.notes.like("Test %")))
        # Revert the setup credit
        if credit_amount > 0:
            await db.execute(delete(LedgerEntry).where(LedgerEntry.description == "Test credit: Setup balance"))
        await db.execute(delete(LedgerEntry).where(LedgerEntry.description == "App distraction today"))
        await db.execute(delete(LedgerEntry).where(LedgerEntry.description.like("Free Scroll pass%")))
        # Restore NAP cooldown
        await db.execute(
            update(MarketplacePass)
            .where(MarketplacePass.pass_type == PassType.NAP)
            .values(cooldown_hours_after_use=6)
        )
        await db.commit()
        print("✅ Database cleanup complete.")
        
        print("\n=== ALL LEISURE MARKETPLACE BACKEND TESTS PASSED ===")

if __name__ == "__main__":
    asyncio.run(test_marketplace())
