import asyncio
import json
import os
from datetime import date as date_cls
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from anthropic import AsyncAnthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from news_service import get_news

load_dotenv()

# Polygon.io rebranded to Massive (massive.com) -- the REST paths are unchanged, but the API now
# lives at api.massive.com (api.polygon.io still answers for legacy integrations, but the current
# docs and new keys point at the new domain, so that's what this uses).
MASSIVE_API_KEY = os.environ.get("MASSIVE_API_KEY", "")
MASSIVE_BASE_URL = "https://api.massive.com"
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = "claude-sonnet-5"

app = FastAPI(title="EP Catalyst Analyzer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

anthropic_client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)


class AnalyzeRequest(BaseModel):
    ticker: str
    date: str  # YYYY-MM-DD


SYSTEM_PROMPT = """You are an elite swing trading catalyst analyst specializing in EP (Episodic Pivot) methodology.

CATALYST LIST (always use these exact categories):
1. Earnings beat + guidance raise
2. Revenue / sales growth
3. Beating analyst estimates
4. Analyst upgrade + price target raise (tier-1)
5. Analyst initiation (post-IPO quiet period)
6. Binding contract / signed deal
7. M&A — definitive agreement (acquirer)
8. M&A — acquisition target
9. M&A rumor (tier-1 source: Bloomberg/Reuters/FT)
10. FDA full approval — first-in-class
11. FDA accelerated approval
12. FDA Fast Track designation
13. FDA Breakthrough Therapy designation
14. FDA Special Protocol Assessment (SPA)
15. Phase 3 positive — primary endpoint met
16. Phase 2 positive data
17. Phase 1 positive / IND clearance
18. Clinical trial enrollment start
19. Technology milestone / scalability proof
20. Product launch — commercial revenue
21. New management / CEO change
22. Government policy change
23. Government contract / binding award
24. Patent monetization / legal settlement
25. Buyback — large scale (>10% float)
26. Dutch auction tender offer
27. Institutional buyer — tier-1 (BlackRock, Fidelity, activist)
28. Index inclusion (Russell, S&P)
29. Commodity supercycle / macro tailwind
30. Sector rotation
31. IPO upsized — top of range
32. Political catalyst
33. Futuristic / narrative catalyst
34. Stories / thematic momentum
35. Service failure (negative)
36. Securities fraud / class action (negative)
37. Reverse split (negative)
38. Non-binding LOI / unnamed partner (weak)
39. War / natural disaster (macro event)
40. 13F filing — small institutional (noise)
41. Academic publication (weak)
42. CEO weekly letter / marketing (noise)
43. Activist investor — takes stake + demands change

EP CHECKLIST (score each YES=1, NO=0):
Q1: Was the stock ignored/suppressed before catalyst?
Q2: Price reaction +5%+ on 2x average volume?
Q3: Is catalyst BETTER than expected?
Q4: Is there a narrative for new buyers?
Q5: Technically above key MAs or breaking out?

VERDICT RULES:
- Score 4-5: TRADE ✅
- Score 2-3: WAIT ⚠️
- Score 0-1: SKIP ❌

NEWS SOURCE PRIORITY (weigh confidence accordingly, note it in catalyst_description if it matters):
TIER 1 (highest confidence — official/regulatory): businesswire, prnewswire, globenewswire, sec.gov
TIER 2 (high confidence — major wire/financial press): reuters, bloomberg, ft.com
TIER 3 (lower confidence — commentary/opinion, verify claims before treating as fact): motleyfool, seekingalpha
Each news item you're given includes its source_tier (1/2/3) and origin (massive = structured news
feed, web_search = live web search fallback). Prefer tier-1/2 sources when they disagree with tier-3.

CRITICAL — if the news list you're given is EMPTY, this does NOT mean there was no catalyst. It means
neither the structured news feed nor a web search surfaced anything for this specific date -- the
catalyst may still be real but poorly covered (common for small/illiquid tickers). In that case, base
your catalyst determination on the price/volume action itself (the size and character of the move is
itself evidence something happened), say explicitly in catalyst_description that no corroborating news
was found, and reflect that uncertainty by lowering rank/ep_score rather than defaulting to SKIP purely
for lack of a news headline.

Always respond in valid JSON only. No markdown, no explanation outside JSON. The JSON must match this exact shape:
{
  "catalyst_type": "#N — Name",
  "catalyst_description": "1-2 sentence explanation in Russian",
  "rank": 7,
  "rank_explanation": "Why this rank in Russian",
  "checklist": {
    "q1_ignored": true,
    "q1_explanation": "...",
    "q2_volume": true,
    "q2_explanation": "...",
    "q3_better_than_expected": true,
    "q3_explanation": "...",
    "q4_narrative": true,
    "q4_explanation": "...",
    "q5_technical": true,
    "q5_explanation": "..."
  },
  "ep_score": 5,
  "verdict": "TRADE",
  "verdict_color": "green",
  "key_risks": ["risk1", "risk2"],
  "similar_setups": ["AEHR 3/31/26", "FLEX 5/5/26"]
}
"""


async def massive_get(client: httpx.AsyncClient, path: str, params: dict) -> dict:
    if not MASSIVE_API_KEY:
        raise HTTPException(status_code=500, detail="MASSIVE_API_KEY is not set in backend/.env")
    try:
        r = await client.get(f"{MASSIVE_BASE_URL}{path}", params={**params, "apiKey": MASSIVE_API_KEY})
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Could not reach Massive (formerly Polygon.io) — check your internet connection")
    if r.status_code == 429:
        raise HTTPException(status_code=429, detail="Massive rate limit reached, try again shortly")
    if r.status_code == 401:
        raise HTTPException(status_code=502, detail="Massive API key rejected — check MASSIVE_API_KEY in backend/.env")
    r.raise_for_status()
    return r.json()


async def fetch_ticker_details(client: httpx.AsyncClient, ticker: str) -> dict:
    """Also used to get the company's full name for the web-search news fallback -- it's called
    unconditionally (not just when the day's bar comes back empty), so this is the single source
    of truth for both ticker validity and company_name."""
    try:
        r = await client.get(
            f"{MASSIVE_BASE_URL}/v3/reference/tickers/{ticker}", params={"apiKey": MASSIVE_API_KEY}
        )
        if r.status_code == 404:
            return {"valid": False, "name": None}
        r.raise_for_status()
        results = r.json().get("results")
        if not results:
            return {"valid": False, "name": None}
        return {"valid": True, "name": results.get("name")}
    except httpx.HTTPStatusError:
        return {"valid": False, "name": None}


async def fetch_daily_bar(client: httpx.AsyncClient, ticker: str, date_str: str) -> Optional[dict]:
    data = await massive_get(
        client, f"/v2/aggs/ticker/{ticker}/range/1/day/{date_str}/{date_str}", {"adjusted": "true"}
    )
    results = data.get("results") or []
    return results[0] if results else None


async def fetch_lookback_bars(client: httpx.AsyncClient, ticker: str, before_date_str: str) -> list[dict]:
    # 60 calendar days back is comfortably enough to cover 20+ trading days plus the ~30-day-ago
    # reference point, even across weekends and holidays.
    before = date_cls.fromisoformat(before_date_str)
    start = before - timedelta(days=60)
    end = before - timedelta(days=1)
    data = await massive_get(
        client,
        f"/v2/aggs/ticker/{ticker}/range/1/day/{start.isoformat()}/{end.isoformat()}",
        {"adjusted": "true", "sort": "asc", "limit": 120},
    )
    return data.get("results") or []


async def fetch_indicator(client: httpx.AsyncClient, ticker: str, date_str: str, kind: str, window: int) -> Optional[float]:
    data = await massive_get(
        client,
        f"/v1/indicators/{kind}/{ticker}",
        {
            "timestamp": date_str,
            "timespan": "day",
            "adjusted": "true",
            "window": window,
            "series_type": "close",
            "order": "desc",
            "limit": 1,
        },
    )
    values = ((data.get("results") or {}).get("values")) or []
    return values[0]["value"] if values else None


def bar_date(bar: dict) -> date_cls:
    return datetime.fromtimestamp(bar["t"] / 1000, tz=timezone.utc).date()


def extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if "\n" in text:
            first_line, rest = text.split("\n", 1)
            if first_line.strip().lower() in ("json", ""):
                text = rest
    return json.loads(text)


@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    ticker = req.ticker.upper().strip()
    date_str = req.date

    async with httpx.AsyncClient(timeout=20.0) as client:
        # Fetched together: ticker_details is needed both for the 404-vs-422 distinction below (if
        # the day's bar is missing) and, when the ticker is valid, for its company_name -- required
        # by the web-search news fallback regardless of whether the bar was found.
        today_bar, ticker_details = await asyncio.gather(
            fetch_daily_bar(client, ticker, date_str),
            fetch_ticker_details(client, ticker),
        )

        if not today_bar:
            if not ticker_details["valid"]:
                raise HTTPException(status_code=404, detail="Ticker not found")
            raise HTTPException(status_code=422, detail="Market closed on this date")

        company_name = ticker_details.get("name") or ticker

        lookback = await fetch_lookback_bars(client, ticker, date_str)
        if not lookback:
            raise HTTPException(status_code=422, detail="Not enough price history for this ticker/date")

        last20 = lookback[-20:]
        avg_volume = sum(b["v"] for b in last20) / len(last20)
        volume_ratio = today_bar["v"] / avg_volume if avg_volume else 0

        prev_close = lookback[-1]["c"]
        price_change_pct = (today_bar["c"] - prev_close) / prev_close * 100 if prev_close else 0

        target_30d = date_cls.fromisoformat(date_str) - timedelta(days=30)
        bars_before_30d = [b for b in lookback if bar_date(b) <= target_30d]
        price_30d_ago = bars_before_30d[-1]["c"] if bars_before_30d else lookback[0]["c"]
        ytd_move_pct = (today_bar["c"] - price_30d_ago) / price_30d_ago * 100 if price_30d_ago else 0

        news = await get_news(client, anthropic_client, ticker, company_name, date_str)

        ema21 = await fetch_indicator(client, ticker, date_str, "ema", 21)
        sma50 = await fetch_indicator(client, ticker, date_str, "sma", 50)
        above_21ema = today_bar["c"] > ema21 if ema21 is not None else None
        above_50sma = today_bar["c"] > sma50 if sma50 is not None else None

    if news:
        news_text = "\n".join(
            f"- [{n.get('source_tier', 2)}] {n['title']} ({n.get('publisher') or 'unknown source'}, via {n.get('origin', 'massive')})"
            for n in news
        )
    else:
        news_text = "Search found no news via Massive. Web search also found nothing for this specific date. Find the real catalyst from the price/volume action before scoring -- see the CRITICAL instruction above about an empty news list."

    user_message = f"""Ticker: {ticker}
Company: {company_name}
Date: {date_str}
Price change: {price_change_pct:.2f}%
Volume: {int(today_bar['v']):,} ({volume_ratio:.2f}x average)
Price vs 21EMA: {'above' if above_21ema else 'below' if above_21ema is not None else 'unknown'}
Price vs 50SMA: {'above' if above_50sma else 'below' if above_50sma is not None else 'unknown'}
Price 30 days ago: {ytd_move_pct:.2f}% change
News count: {len(news)}
News headlines (format: [source_tier] title (publisher, origin)):
{news_text}

Analyze this EP setup and return JSON with the exact structure specified in your instructions."""

    try:
        message = await anthropic_client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=2000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
        # content[0] isn't reliably the text block -- e.g. a thinking block can come first --
        # so pick out every text block instead of assuming position.
        raw_text = "".join(block.text for block in message.content if block.type == "text")
        if not raw_text:
            raise HTTPException(status_code=502, detail="Claude returned no text content")
        analysis = extract_json(raw_text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Claude returned invalid JSON")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e}")

    return {
        "ticker": ticker,
        "company_name": company_name,
        "date": date_str,
        "price": {
            "open": today_bar["o"],
            "high": today_bar["h"],
            "low": today_bar["l"],
            "close": today_bar["c"],
            "volume": today_bar["v"],
        },
        "price_change_pct": round(price_change_pct, 2),
        "volume_ratio": round(volume_ratio, 2),
        "ytd_move_30d_pct": round(ytd_move_pct, 2),
        "above_21ema": above_21ema,
        "above_50sma": above_50sma,
        "news": news,
        "analysis": analysis,
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
