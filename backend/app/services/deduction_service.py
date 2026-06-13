import json
from app.services.ai_service import _call_ai_text
from app.services import ledger_service
from app.models.ledger import LedgerCategory

OVERRIDE_TAX_PCT = 0.20   # 20% extra if overriding AI rejection


async def validate_deduction_with_ai(
    amount: int,
    reason: str,
    hourly_earn_rate: int,
) -> dict:
    """
    AI validates whether a manual self-penalty is reasonable and proportional.
    It should reject:
      - Vague reasons ("I was bad today")
      - Disproportionately large amounts for minor infractions
      - Reasons that don't match the category (e.g. claiming financial penalty for a physical habit)
    It may suggest a reduced amount.
    """
    prompt = f"""You are a fair personal accountability coach reviewing a self-imposed penalty.

The user wants to deduct ₹{amount} from their virtual wallet as a self-penalty.
Their hourly study earn rate is ₹{hourly_earn_rate}/hr.
Their reason: "{reason}"

Evaluate this penalty:
1. Is the reason specific and genuine? (reject vague reasons like "I was bad")
2. Is the amount proportional to the infraction relative to their earn rate?
   (e.g. ₹{hourly_earn_rate * 2} for wasting an entire study day is reasonable;
    ₹{hourly_earn_rate * 10} for checking Instagram once is not)
3. If the amount seems excessive, suggest a more proportional amount.

Respond ONLY with valid JSON, no markdown:
{{
  "verdict": "APPROVED" or "REJECTED" or "REDUCED",
  "approved_amount": integer (same as requested if APPROVED, 0 if REJECTED, reduced if REDUCED),
  "reasoning": "one or two sentence explanation"
}}"""

    response = await _call_ai_text(prompt, max_tokens=1000)
    try:
        return json.loads(response)
    except Exception:
        return {"verdict": "APPROVED", "approved_amount": amount,
                "reasoning": "AI unavailable — penalty approved as submitted"}
