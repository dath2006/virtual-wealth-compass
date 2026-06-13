import asyncio
import os
from dotenv import load_dotenv

# Load env variables from .env
load_dotenv()

from app.services.ai_service import classify_transaction, validate_evidence

async def main():
    print("=== Testing Nvidia NIM via Backend AI Service ===\n")
    
    # 1. Test Transaction Classification (Text)
    print("1. Testing classify_transaction (Mistral-3.5-128b)...")
    merchant = "Zara"
    amount = 1500
    raw_text = "Paid Rs. 1500 to Zara on UPI"
    
    result, verified = await classify_transaction(merchant, amount, raw_text)
    print(f"Merchant: {merchant}")
    print(f"Amount: Rs. {amount}")
    print(f"Classification Result: {result}")
    print(f"Verified via AI: {verified}\n")

    # 2. Test Evidence Validation (Vision)
    print("2. Testing validate_evidence (Llama-3.2-11b-vision)...")
    # Tiny 1x1 black JPEG base64
    dummy_image_base64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
    
    claim = "Studying algorithms for 2 hours"
    subject = "Computer Science"
    claimed_amount = 200
    hourly_rate = 100
    
    result_dict = await validate_evidence(
        claim_description=claim,
        subject=subject,
        claimed_amount=claimed_amount,
        hourly_rate=hourly_rate,
        image_base64=dummy_image_base64,
        past_sessions_today=[]
    )
    print(f"Claim: '{claim}'")
    print(f"Audit Result: {result_dict}")

if __name__ == "__main__":
    asyncio.run(main())
