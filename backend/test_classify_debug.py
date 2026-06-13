import asyncio
import httpx
from app.config import get_settings
from app.services.ai_service import _call_ai_text, _parse_json, classify_transaction

async def test_direct():
    settings = get_settings()
    merchant = "Zara"
    amount = 1500
    raw_text = "Paid Rs. 1500 to Zara on UPI"
    
    prompt = f"""Classify this UPI payment. Respond ONLY with valid JSON, no markdown:
{{"class": "ESSENTIAL" or "DISCRETIONARY", "confidence": 0.0-1.0}}

Merchant: {merchant}
Amount: ₹{amount}
Transaction note: {raw_text[:200]}

Essential = groceries at physical store, medicine, rent, electricity/water bill, local transport fares.
Discretionary = food delivery apps, online shopping, entertainment subscriptions, restaurants."""

    print("=== Calling _call_ai_text directly ===")
    try:
        response = await _call_ai_text(prompt, max_tokens=500, temperature=0.1)
        print(f"Raw Response: {repr(response)}")
        if response:
            parsed = _parse_json(response)
            print(f"Parsed JSON: {parsed}")
    except Exception as e:
        import traceback
        traceback.print_exc()

    print("\n=== Calling classify_transaction ===")
    res, verified = await classify_transaction(merchant, amount, raw_text)
    print(f"Result: {res}, Verified: {verified}")

if __name__ == "__main__":
    asyncio.run(test_direct())
