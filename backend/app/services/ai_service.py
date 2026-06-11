import httpx
import json
import base64
from app.config import get_settings

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"


async def _call_gemini_text(prompt: str, max_tokens: int = 500) -> str:
    """
    Shared helper: send a text-only prompt to Gemini and return the raw text response.
    Returns empty string on failure (callers should handle gracefully).
    """
    settings = get_settings()
    if not settings.google_ai_studio_api_key:
        return ""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{GEMINI_API_URL}?key={settings.google_ai_studio_api_key}",
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.3, "maxOutputTokens": max_tokens},
                },
            )
            if resp.status_code != 200:
                return ""
            raw = resp.json()
            return raw["candidates"][0]["content"]["parts"][0]["text"]
    except Exception:
        return ""


def _parse_json(text: str) -> dict:
    """Safely extracts and parses JSON even if wrapped in markdown code blocks."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return json.loads(text)

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
    if not settings.google_ai_studio_api_key:
        return "UNKNOWN", False

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{GEMINI_API_URL}?key={settings.google_ai_studio_api_key}",
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.1, "maxOutputTokens": 500}
                }
            )
            if response.status_code != 200:
                return "UNKNOWN", False

            raw = response.json()
            text = raw["candidates"][0]["content"]["parts"][0]["text"]
            parsed = _parse_json(text)
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
    if not settings.google_ai_studio_api_key:
        return {"verified": False, "approved_amount": 0,
                "reasoning": "AI key not configured", "confidence": 0.0}

    try:
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
                    "generationConfig": {"temperature": 0.1, "maxOutputTokens": 500}
                }
            )
            if response.status_code != 200:
                return {"verified": False, "approved_amount": 0,
                        "reasoning": f"AI service error {response.status_code}", "confidence": 0.0}

            raw = response.json()
            text = raw["candidates"][0]["content"]["parts"][0]["text"]
            return _parse_json(text)
    except Exception as e:
        return {"verified": False, "approved_amount": 0,
                "reasoning": f"AI validation exception: {str(e)}", "confidence": 0.0}
