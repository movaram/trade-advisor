"""Optional free-tier LLM analysis via Google Gemini's REST API. Only used when GEMINI_API_KEY is
set; every failure (no key, rate limit, model gone, bad JSON) returns None so main.py falls back
to the free rule-based analysis instead of erroring.

Gemini model names change often and Google retires old ones, so instead of hard-coding one this
asks the API which models the key can use and tries the "flash" models (the family with a free
tier): full flash newest first, then flash-lite as a last resort. Availability swings minute to
minute (503 "high demand", 429 quota, 403 on some models, 404 for listed-but-retired ones), so on any of those or a
timeout it moves on to the next one, and the model that last worked is tried first next time.
GEMINI_MODEL in .env pins a single model instead."""

import json
import os
import re
import time
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL_OVERRIDE = os.environ.get("GEMINI_MODEL", "")
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

MAX_MODELS_TO_TRY = 6
PER_MODEL_TIMEOUT = 45.0
TOTAL_BUDGET_SECONDS = 90.0  # then give up and let the rule engine answer

# Per-model failures where another model may still work; anything else (e.g. 400 bad request,
# 401 bad key) would fail the same way on every model, so it stops immediately.
SKIP_TO_NEXT_MODEL = {403: "no access", 404: "retired", 429: "free-tier limit", 500: "server error", 503: "overloaded"}

_cached_models: Optional[list[str]] = None
_last_working: Optional[str] = None


def _version_key(name: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", name.split("/")[-1])[:3])


async def _candidate_models(client: httpx.AsyncClient) -> list[str]:
    global _cached_models
    if GEMINI_MODEL_OVERRIDE:
        return [GEMINI_MODEL_OVERRIDE]
    if _cached_models:
        return _cached_models
    r = await client.get(f"{GEMINI_BASE_URL}/models", headers={"x-goog-api-key": GEMINI_API_KEY}, params={"pageSize": 200})
    if not r.is_success:
        return []
    names = {
        m["name"].split("/")[-1]
        for m in r.json().get("models", [])
        if "generateContent" in (m.get("supportedGenerationMethods") or [])
    }
    # Plain numbered releases only -- skips -preview, -image, -tts, "latest" aliases, omni...
    full = sorted((n for n in names if re.fullmatch(r"gemini-[\d.]+-flash", n)), key=_version_key, reverse=True)
    lite = sorted((n for n in names if re.fullmatch(r"gemini-[\d.]+-flash-lite", n)), key=_version_key, reverse=True)
    _cached_models = (full[:4] + lite[:2])[:MAX_MODELS_TO_TRY]
    return _cached_models


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise


async def analyze_with_gemini(client: httpx.AsyncClient, system_prompt: str, user_message: str) -> tuple[Optional[dict], Optional[str]]:
    """Returns (analysis, model_name) on success, or (None, reason) on any failure."""
    if not GEMINI_API_KEY:
        return None, "GEMINI_API_KEY not set"
    try:
        models = await _candidate_models(client)
    except (httpx.HTTPError, ValueError, KeyError) as e:
        return None, f"Gemini error: {type(e).__name__}"
    if not models:
        return None, "no Gemini flash model available for this key"

    global _last_working
    if _last_working in models:
        models = [_last_working] + [m for m in models if m != _last_working]
    started = time.monotonic()
    reasons = []
    for model in models:
        remaining = TOTAL_BUDGET_SECONDS - (time.monotonic() - started)
        if remaining < 5:
            reasons.append("time budget used up")
            break
        try:
            r = await client.post(
                f"{GEMINI_BASE_URL}/models/{model}:generateContent",
                headers={"x-goog-api-key": GEMINI_API_KEY},
                json={
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                    "contents": [{"role": "user", "parts": [{"text": user_message}]}],
                    "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
                },
                timeout=min(PER_MODEL_TIMEOUT, remaining),
            )
        except httpx.TimeoutException:
            reasons.append(f"{model}: timeout")
            continue
        except httpx.HTTPError as e:
            return None, f"Gemini error: {type(e).__name__}"
        if r.status_code in SKIP_TO_NEXT_MODEL:
            reasons.append(f"{model}: {SKIP_TO_NEXT_MODEL[r.status_code]}")
            continue
        if not r.is_success:
            return None, f"Gemini HTTP {r.status_code} ({model})"
        try:
            parts = ((r.json().get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
            text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
            analysis = _extract_json(text) if text else None
        except (ValueError, KeyError, IndexError):
            analysis = None
        if not isinstance(analysis, dict) or "catalyst_type" not in analysis:
            return None, f"Gemini returned an unexpected answer ({model})"
        _last_working = model
        return analysis, model
    return None, "; ".join(reasons)
