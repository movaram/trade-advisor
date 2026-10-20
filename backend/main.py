import asyncio
import json
import os
from datetime import date as date_cls
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from gemini_analysis import analyze_with_gemini
from news_service import get_news
from rules_analysis import MarketData, analyze_with_rules, finalize_rules_analysis

load_dotenv()

# Polygon.io rebranded to Massive (massive.com) -- the REST paths are unchanged, but the API now
# lives at api.massive.com (api.polygon.io still answers for legacy integrations, but the current
# docs and new keys point at the new domain, so that's what this uses).
MASSIVE_API_KEY = os.environ.get("MASSIVE_API_KEY", "")
MASSIVE_BASE_URL = "https://api.massive.com"

app = FastAPI(title="EP Catalyst Analyzer")
# Routes are registered under both "/" and "/api" (see the include_router calls at the bottom):
# locally the frontend calls http://localhost:8000/analyze, while on Vercel the same app runs as
# the api/index.py function and receives the public path /api/analyze.
router = APIRouter()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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

SETUP CLASSIFICATION (run this FIRST, before any checklist scoring -- it decides which checklist
applies below). You're given 90+ days of price history, the 30-day move, the 90-day move, where
the event-day close sits relative to the 90-day high/low, and the event day's intraday OHLC.
Classify setup_type as exactly one of:

EP (Episodic Pivot):
- 30-day move before the event < 15%, stock in a base or near its lows, fresh catalyst on the
  event day itself -> apply the EP CHECKLIST below.

MOMENTUM BREAKOUT:
- Stock already up 30%+ over the prior 30-90 days, price near its highs (not in a base), breaking
  out of a consolidation -> apply the MOMENTUM CHECKLIST below. A momentum setup does NOT need a
  news catalyst -- strong prior trend + technical breakout is enough on its own.

DEP (Delayed Episodic Pivot):
- The news catalyst (per the dated news list you're given) published 5+ days before the event
  date, and the stock is only reacting now -> apply the EP CHECKLIST (same as EP), and say in
  setup_explanation "DEP -- reacting N days after the catalyst".

FAILED BREAKOUT:
- The event day's high broke above the prior 90-day high (or another clear resistance level) but
  the close came back inside the prior range, especially close < open on elevated volume -> no
  checklist applies; verdict is SKIP for longs regardless of anything else. Report the level that
  failed and the price that would need to reclaim it to reset the long case.

If ambiguous: choose EP if a same-day catalyst exists; choose MOMENTUM if there's strong prior
trend but no fresh catalyst.

EP CHECKLIST (used when setup_type is EP or DEP; score each YES=true, NO=false):
Q1: Was the stock ignored/suppressed before catalyst? YES if 30-day move <15% and in a base;
    NO if already up 50%+ before the event.
Q2: Price reaction +5%+ on 2x average volume? YES if strong gap + elevated volume; NO if muted.
Q3: Is catalyst BETTER than expected? YES if EPS beat >25%, a named surprise, or guidance well
    above consensus; NO if in line with expectations.
Q4: Is there a narrative for new buyers? YES if turnaround, a hot theme (AI/defense/energy),
    first profitable quarter, or structural change; NO if a boring mature business, no tailwind.
Q5: Technically above key MAs or breaking out? YES if above 21EMA and 50SMA; NO if below, in a
    downtrend.

MOMENTUM CHECKLIST (used when setup_type is MOMENTUM; score each YES=true, NO=false):
M1: Prior impulse 30%+ in the last 1-3 months? YES if a clear leader move before the current base;
    NO if weak or choppy prior trend.
M2: Orderly consolidation for 2-8 weeks? YES if higher lows, holding the 21EMA/50SMA, pullback
    shallower than the sector; NO if a deep sloppy pullback or lost the 50SMA.
M3: Tightening before breakout? YES if the range is contracting, volume drying up, the 10/21 EMA
    catching up with price; NO if wide volatile candles into the pivot.
M4: Quality breakout day? YES if closing near the day's high with volume >1.5x average; NO if
    closing weak or back inside the prior range.
M5: Group/theme leadership? YES if outperforming peers and the sector; NO if lagging the group.

FAILED BREAKOUT: no checklist -- checklist_type is "failed" and checklist is null. Instead fill
in failed_breakout: the level that failed (failed_level), the price needed to reclaim it for the
long case to reset (reclaim_level), and a short observation of what happened.

Do NOT compute setup_score, ep_score, catalyst_strength.total/label, combined_score, verdict, or
verdict_color yourself -- the backend derives all of those deterministically from the checklist
booleans and the dimension scores you provide below. Just answer the checklist and dimensions
honestly; the arithmetic is not your job.

NEWS SOURCE PRIORITY (weigh confidence accordingly, note it in catalyst_description if it matters):
TIER 1 (highest confidence — official/regulatory): businesswire, prnewswire, globenewswire, sec.gov
TIER 2 (high confidence — major wire/financial press): reuters, bloomberg, ft.com
TIER 3 (lower confidence — commentary/opinion, verify claims before treating as fact): motleyfool, seekingalpha
Each news item you're given includes its source_tier (1/2/3), origin (massive or finnhub, both
structured news feeds), its publication date, and how many days before/after the event date it was
published. An item published several days before the event with the stock only reacting today is
exactly the DEP signal described in SETUP CLASSIFICATION above -- use those day counts for that
determination rather than guessing from the headline alone. Prefer tier-1/2 sources when they
disagree with tier-3.

ANALYST ACTION SCORING (only relevant when checklist_type is "ep" -- momentum and failed-breakout
setups don't use this) — apply this whenever the news contains analyst upgrades/downgrades or price
target (PT) changes; if there's no analyst activity in the news, skip this section and set
checklist.analyst_confirmation to null.
1. COUNT how many distinct analysts/firms acted on the same day as the primary catalyst.
   1 analyst = weak signal. 3+ analysts acting the same day = strong confirmation.
2. TIER the analyst firms:
   TIER 1: Goldman Sachs, Morgan Stanley, JPMorgan, UBS, Barclays, Bank of America
   TIER 2: Oppenheimer, Needham, Canaccord, RBC, Piper Sandler
   TIER 3: small boutiques or firms not in the above lists
3. MEASURE the magnitude of each PT raise (% change from old PT to new PT) and classify the largest one:
   >50% = very strong, 25-50% = strong, 10-25% = moderate, <10% = noise
4. Populate checklist.analyst_confirmation with:
   {"analyst_count": <int>, "highest_tier": "T1"|"T2"|"T3", "max_pt_raise_pct": <number>,
    "summary": "X analysts, highest tier: T1/T2/T3, max PT raise: +X%"}
   The backend automatically adds a +0.5 setup_score boost when this shows a Tier-1 analyst raising
   PT by more than 25% -- just report the facts accurately, don't add the boost yourself.

CATALYST STRENGTH SCORING — separate from the EP checklist above, score these 5 dimensions
(0-3 points each, 15 max total) to measure how substantial the catalyst itself is:

1. SOURCE QUALITY (0-3):
   3 = Primary source: 8-K filing, GlobeNewswire, BusinessWire, PRNewswire, company IR page
   2 = Tier-2 media: Reuters, Bloomberg, FT, WSJ, CNBC
   1 = Tier-3: Motley Fool, SeekingAlpha, Zacks, StockAnalysis
   0 = No source found / unverifiable

2. SPECIFICITY (0-3):
   3 = Named counterparty + specific $ amount (e.g. "$41M order from Amazon")
   2 = Named counterparty, no $ amount (e.g. "Contract with Google")
   1 = Unnamed partner, vague terms (e.g. "Major hyperscaler partnership")
   0 = No counterparty, pure narrative

3. MAGNITUDE (0-3):
   For an earnings catalyst, score by EPS beat vs. consensus:
     3 = beat >50%, 2 = beat 25-50%, 1 = beat 10-25%, 0 = beat <10% or a miss
   For a non-earnings catalyst, score by estimated value relative to market cap:
     3 = transformational (>20% of market cap), 2 = significant (10-20%),
     1 = moderate (<10%), 0 = immaterial/symbolic

4. ANALYST CONFIRMATION (0-3) — same underlying facts as checklist.analyst_confirmation above,
   scored on this different scale for this dimension specifically:
   3 = 3+ analysts raised PT same day, at least one Tier-1
       (Goldman Sachs, Morgan Stanley, JPMorgan, UBS, Barclays, Bank of America)
   2 = 1-2 Tier-1 analysts OR 3+ Tier-2 analysts
       (Oppenheimer, Needham, RBC, Canaccord, Piper Sandler, William Blair)
   1 = only Tier-3 analysts / boutiques
   0 = no analyst action

5. NOVELTY (0-3):
   3 = completely new information, market had no prior knowledge
   2 = confirms rumors/expectations but with better-than-expected details
   1 = known story, minor update
   0 = already fully priced in

(The backend sums these 5 dimensions into catalyst_strength.total, maps it to a label, and combines
it with setup_score into the final verdict -- you only need to score the dimensions honestly.)

ACTION PLAN — for every setup (including WAIT and SKIP), generate a concrete plan grounded in the
real price levels you're given (event-day OHLC, 21EMA/50SMA, 90-day high/low):
- trigger: exact entry condition with a real price level, e.g. "Пробой выше $46.50 (максимум дня
  катализатора)". EP/DEP: break above the event day's high. MOMENTUM: break above the consolidation
  high (use the 90-day high if that's what's being broken out of). FAILED BREAKOUT: reclaim and
  close back above the failed level.
- stop: a real price level -- the event day's low, or the base/consolidation low from the price
  history you're given.
- invalidation: what price action cancels the setup. EP/DEP: close back below the gap/event-day
  low. MOMENTUM: close back below the breakout level or loss of the 21EMA.
- management: how to manage a working trade. EP/DEP: sell part of the position at +10-15%, trail
  the rest on the 21EMA. MOMENTUM: same partial-sell logic but trail the 10EMA (use the 21EMA
  instead if the base was 6+ weeks long).
- skip_conditions: ONLY when the verdict will be a SKIP variant or WAIT -- describe concretely what
  needs to change (price level, news development, time passing) for the setup to become tradeable,
  and a rough timeframe. Omit/null this field for TRADE-family verdicts.
Do not fill in "size" -- the backend computes position size from the verdict and market cap/price.

CRITICAL — if the news list you're given is EMPTY, this does NOT mean there was no catalyst. For an
EP or DEP setup it means neither news feed (Massive, Finnhub) surfaced anything in the
window around this date -- the catalyst may still be real but poorly covered (common for small/illiquid
tickers); base your catalyst determination on the price/volume action itself, say explicitly in
catalyst_description that no corroborating news was found, and reflect that uncertainty by lowering
rank/checklist scores rather than defaulting to SKIP purely for lack of a headline. For a MOMENTUM
setup, empty news is often completely normal -- a pure technical/thematic breakout doesn't need a
news catalyst at all, so don't penalize it for that.

Always respond in valid JSON only. No markdown, no explanation outside JSON. The JSON must match this
exact shape (this example is an EP/DEP setup -- see the notes below for how MOMENTUM and
FAILED_BREAKOUT differ):
{
  "catalyst_type": "#N — Name",
  "catalyst_description": "Plain Russian for a non-trader, exactly three parts: 'Что произошло: ... Когда: <date of the news, and whether it was after the close the day before> ... Почему акция выросла/упала на X%: <the concrete reasons with real numbers from the news: EPS/revenue vs estimates, guidance, deal size, theme, volume>.' Use only facts present in the data you're given",
  "catalyst_news_date": "YYYY-MM-DD publication date of the news item that is the catalyst, or null if no news item is the catalyst",
  "catalyst_news_summary": "2-3 sentences in Russian retelling what that news actually said (numbers, guidance, deal terms), or null",
  "rank": 7,
  "rank_explanation": "Why this rank in Russian",
  "setup_type": "EP",
  "setup_explanation": "1 sentence in Russian",
  "checklist_type": "ep",
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
    "q5_explanation": "...",
    "analyst_confirmation": {
      "analyst_count": 3,
      "highest_tier": "T1",
      "max_pt_raise_pct": 45.5,
      "summary": "3 analysts, highest tier: T1, max PT raise: +45.5%"
    }
  },
  "key_risks": ["risk1", "risk2"],
  "similar_setups": ["AEHR 3/31/26", "FLEX 5/5/26"],
  "catalyst_strength": {
    "dimensions": {
      "source_quality": 3,
      "source_quality_explanation": "... in Russian",
      "specificity": 2,
      "specificity_explanation": "... in Russian",
      "magnitude": 3,
      "magnitude_explanation": "... in Russian",
      "analyst_confirmation": 2,
      "analyst_confirmation_explanation": "... in Russian",
      "novelty": 3,
      "novelty_explanation": "... in Russian"
    }
  },
  "action_plan": {
    "trigger": "... in Russian, with a real price",
    "stop": "... in Russian, with a real price",
    "invalidation": "... in Russian, with a real price",
    "management": "... in Russian",
    "skip_conditions": null
  }
}
checklist.analyst_confirmation is null when there's no analyst upgrade/PT-raise activity in the news --
don't fabricate one. catalyst_strength.dimensions.analyst_confirmation is a SEPARATE 0-3 scale from
checklist.analyst_confirmation -- both describe the same underlying analyst activity but for different
purposes (checklist tracks the raw facts for the setup_score boost; catalyst_strength scores how much
that activity strengthens the catalyst itself), so score them independently and don't force them to
agree.

For setup_type "MOMENTUM": checklist_type is "momentum" and checklist instead has
{"m1_impulse": true, "m1_explanation": "...", "m2_consolidation": true, "m2_explanation": "...",
"m3_tightening": true, "m3_explanation": "...", "m4_breakout_day": true, "m4_explanation": "...",
"m5_leadership": true, "m5_explanation": "..."} -- no analyst_confirmation key at all (that's
EP/DEP-only). catalyst_strength is still scored (it can be genuinely low/zero if there's no news
catalyst -- that's fine and expected for a pure technical breakout).

For setup_type "FAILED_BREAKOUT": checklist_type is "failed" and checklist is null. Add a
failed_breakout object instead: {"failed_level": 45.20, "reclaim_level": 46.50,
"short_observation": "... in Russian"}. action_plan.skip_conditions must be filled in (verdict is
always SKIP for this setup type); trigger/stop/invalidation/management can describe the reclaim
scenario briefly or be empty strings.
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
    """Also used to get the company's full name (for news relevance matching) and market
    cap (for the action plan's small-cap position-size halving rule) -- it's called
    unconditionally (not just when the day's bar comes back empty), so this is the single source
    of truth for ticker validity, company_name, and market_cap."""
    try:
        r = await client.get(
            f"{MASSIVE_BASE_URL}/v3/reference/tickers/{ticker}", params={"apiKey": MASSIVE_API_KEY}
        )
        if r.status_code == 404:
            return {"valid": False, "name": None, "market_cap": None}
        r.raise_for_status()
        results = r.json().get("results")
        if not results:
            return {"valid": False, "name": None, "market_cap": None}
        return {"valid": True, "name": results.get("name"), "market_cap": results.get("market_cap")}
    except httpx.HTTPStatusError:
        return {"valid": False, "name": None, "market_cap": None}


async def fetch_daily_bar(client: httpx.AsyncClient, ticker: str, date_str: str) -> Optional[dict]:
    data = await massive_get(
        client, f"/v2/aggs/ticker/{ticker}/range/1/day/{date_str}/{date_str}", {"adjusted": "true"}
    )
    results = data.get("results") or []
    return results[0] if results else None


async def fetch_lookback_bars(client: httpx.AsyncClient, ticker: str, before_date_str: str) -> list[dict]:
    # 100 calendar days back covers the ~90-day prior-impulse window setup classification needs
    # (Momentum's "up 30%+ in the last 1-3 months") with margin for weekends/holidays, on top of
    # the 20-day avg-volume and ~30-day-ago reference point the rest of the analysis already used.
    before = date_cls.fromisoformat(before_date_str)
    start = before - timedelta(days=100)
    end = before - timedelta(days=1)
    data = await massive_get(
        client,
        f"/v2/aggs/ticker/{ticker}/range/1/day/{start.isoformat()}/{end.isoformat()}",
        {"adjusted": "true", "sort": "asc", "limit": 150},
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


# --- Deterministic scoring -------------------------------------------------------------------
# The analyzer (Gemini or the rule engine) supplies the qualitative checklist answers and dimension scores; everything that's pure
# arithmetic or a fixed lookup table is computed here instead, so a bad LLM addition or an
# ambiguous verdict-matrix cell can't silently produce a wrong TRADE/SKIP call.

EP_CHECKLIST_KEYS = ["q1_ignored", "q2_volume", "q3_better_than_expected", "q4_narrative", "q5_technical"]
MOMENTUM_CHECKLIST_KEYS = ["m1_impulse", "m2_consolidation", "m3_tightening", "m4_breakout_day", "m5_leadership"]
CATALYST_STRENGTH_KEYS = ["source_quality", "specificity", "magnitude", "analyst_confirmation", "novelty"]


def analyst_boost_applies(analyst_confirmation: Optional[dict]) -> bool:
    if not analyst_confirmation:
        return False
    return analyst_confirmation.get("highest_tier") == "T1" and (analyst_confirmation.get("max_pt_raise_pct") or 0) > 25


def compute_setup_score(checklist_type: str, checklist: Optional[dict]) -> float:
    if checklist_type == "failed" or not checklist:
        return 0.0
    if checklist_type == "momentum":
        return float(sum(1 for k in MOMENTUM_CHECKLIST_KEYS if checklist.get(k)))
    base = sum(1 for k in EP_CHECKLIST_KEYS if checklist.get(k))
    boost = 0.5 if analyst_boost_applies(checklist.get("analyst_confirmation")) else 0
    return base + boost


def compute_catalyst_strength(dimensions: Optional[dict]) -> dict:
    dims = dimensions or {}
    total = sum(int(dims.get(k) or 0) for k in CATALYST_STRENGTH_KEYS)
    if total >= 13:
        label, color = "Exceptional", "green"
    elif total >= 10:
        label, color = "Strong", "green"
    elif total >= 7:
        label, color = "Moderate", "yellow"
    elif total >= 4:
        label, color = "Weak", "orange"
    else:
        label, color = "Noise", "red"
    return {"dimensions": dims, "total": total, "label": label, "label_color": color}


def compute_verdict(setup_type: str, setup_score: float, catalyst_total: int) -> tuple[str, str]:
    """Returns (verdict_strength, verdict_color)."""
    if setup_type == "FAILED_BREAKOUT":
        return "SKIP", "red"
    if setup_type == "MOMENTUM":
        if setup_score >= 5:
            return ("STRONG TRADE", "green") if catalyst_total >= 7 else ("TRADE", "green")
        if setup_score == 4:
            return "TRADE", "green"
        if setup_score == 3:
            return "TRADE WITH CAUTION", "teal"
        if setup_score == 2:
            return "WAIT", "yellow"
        return "SKIP", "red"
    # EP or DEP
    if setup_score < 2:
        return "SKIP", "red"
    if catalyst_total <= 3:
        return "SKIP - WEAK CATALYST", "red"
    if setup_score >= 4:
        if catalyst_total >= 10:
            return "STRONG TRADE", "green"
        if catalyst_total >= 7:
            return "TRADE", "green"
        return "TRADE WITH CAUTION", "teal"
    if catalyst_total >= 10:
        return "WAIT - STRONG CATALYST", "yellow"
    return "WAIT", "yellow"


def coarse_verdict(verdict_strength: str) -> str:
    if verdict_strength in ("STRONG TRADE", "TRADE", "TRADE WITH CAUTION"):
        return "TRADE"
    if verdict_strength in ("WAIT - STRONG CATALYST", "WAIT"):
        return "WAIT"
    return "SKIP"


def compute_size(verdict_strength: str, market_cap: Optional[float], price: float) -> str:
    base = {"STRONG TRADE": "1R", "TRADE": "0.75R", "TRADE WITH CAUTION": "0.5R"}.get(verdict_strength)
    if base is None:
        return "0"
    small_or_cheap = (market_cap is not None and market_cap < 500_000_000) or price < 5
    if small_or_cheap:
        return {"1R": "0.5R", "0.75R": "0.375R", "0.5R": "0.25R"}[base]
    return base


@router.post("/analyze")
async def analyze(req: AnalyzeRequest):
    ticker = req.ticker.upper().strip()
    date_str = req.date

    async with httpx.AsyncClient(timeout=20.0) as client:
        # Fetched together: ticker_details is needed both for the 404-vs-422 distinction below (if
        # the day's bar is missing) and, when the ticker is valid, for its company_name and market_cap.
        today_bar, ticker_details = await asyncio.gather(
            fetch_daily_bar(client, ticker, date_str),
            fetch_ticker_details(client, ticker),
        )

        if not today_bar:
            if not ticker_details["valid"]:
                raise HTTPException(status_code=404, detail="Ticker not found")
            raise HTTPException(status_code=422, detail="Market closed on this date")

        company_name = ticker_details.get("name") or ticker
        market_cap = ticker_details.get("market_cap")

        lookback = await fetch_lookback_bars(client, ticker, date_str)
        if not lookback:
            raise HTTPException(status_code=422, detail="Not enough price history for this ticker/date")

        last20 = lookback[-20:]
        avg_volume = sum(b["v"] for b in last20) / len(last20)
        volume_ratio = today_bar["v"] / avg_volume if avg_volume else 0

        prev_close = lookback[-1]["c"]
        price_change_pct = (today_bar["c"] - prev_close) / prev_close * 100 if prev_close else 0

        event_date = date_cls.fromisoformat(date_str)
        target_30d = event_date - timedelta(days=30)
        bars_before_30d = [b for b in lookback if bar_date(b) <= target_30d]
        price_30d_ago = bars_before_30d[-1]["c"] if bars_before_30d else lookback[0]["c"]
        ytd_move_pct = (today_bar["c"] - price_30d_ago) / price_30d_ago * 100 if price_30d_ago else 0

        # Setup classification needs the longer-horizon shape too: a stock can look calm over the
        # last 30 days while having already run 40% over the prior 60 -- that's a Momentum base,
        # not an EP setup, and only shows up if we look further back than 30 days.
        price_90d_ago = lookback[0]["c"]
        move_90d_pct = (today_bar["c"] - price_90d_ago) / price_90d_ago * 100 if price_90d_ago else 0
        high_90d = max(b["h"] for b in lookback)
        low_90d = min(b["l"] for b in lookback)
        pct_from_90d_high = (today_bar["c"] - high_90d) / high_90d * 100 if high_90d else 0
        pct_from_90d_low = (today_bar["c"] - low_90d) / low_90d * 100 if low_90d else 0

        sampled = lookback[::5]
        if lookback and sampled[-1] is not lookback[-1]:
            sampled = sampled + [lookback[-1]]
        price_history_text = "\n".join(f"{bar_date(b).isoformat()}: close={b['c']}" for b in sampled)

        news = await get_news(client, ticker, date_str)

        ema21 = await fetch_indicator(client, ticker, date_str, "ema", 21)
        sma50 = await fetch_indicator(client, ticker, date_str, "sma", 50)
        above_21ema = today_bar["c"] > ema21 if ema21 is not None else None
        above_50sma = today_bar["c"] > sma50 if sma50 is not None else None

    def days_before_event(published_date: Optional[str]) -> Optional[int]:
        if not published_date:
            return None
        try:
            return (event_date - date_cls.fromisoformat(published_date)).days
        except ValueError:
            return None

    if news:
        news_lines = []
        for n in news:
            gap = days_before_event(n.get("published_date"))
            if gap is None:
                gap_text = "date unknown"
            elif gap == 0:
                gap_text = "same day as event"
            elif gap > 0:
                gap_text = f"{gap} day(s) before event"
            else:
                gap_text = f"{-gap} day(s) after event"
            n["days_from_event"] = -gap if gap is not None else None
            line = (
                f"- [{n.get('source_tier', 2)}] {n['title']} ({n.get('publisher') or 'unknown source'}, "
                f"published {n.get('published_date') or 'unknown'}, {gap_text}, via {n.get('origin', 'massive')})"
            )
            if n.get("description"):
                line += f"\n  Summary: {n['description'][:400]}"
            news_lines.append(line)
        news_text = "\n".join(news_lines)
    else:
        news_text = "No news found in Massive or Finnhub for the window around this date. If this is an EP/DEP setup, find the real catalyst from the price/volume action before scoring -- see the CRITICAL instruction above. If this looks like a MOMENTUM setup, no news at all is normal."

    market_cap_text = f"${market_cap:,.0f}" if market_cap else "unknown"

    user_message = f"""Ticker: {ticker}
Company: {company_name}
Date: {date_str}
Price change: {price_change_pct:.2f}%
Volume: {int(today_bar['v']):,} ({volume_ratio:.2f}x average)
Price vs 21EMA: {'above' if above_21ema else 'below' if above_21ema is not None else 'unknown'}
Price vs 50SMA: {'above' if above_50sma else 'below' if above_50sma is not None else 'unknown'}
Intraday: Open {today_bar['o']} High {today_bar['h']} Low {today_bar['l']} Close {today_bar['c']}
Market cap: {market_cap_text}
Price 30 days ago: {ytd_move_pct:.2f}% change
Price 90 days ago: {move_90d_pct:.2f}% change
90-day high: {high_90d} ({pct_from_90d_high:+.2f}% from event-day close)
90-day low: {low_90d} ({pct_from_90d_low:+.2f}% from event-day close)
Price history sample (every ~5th trading day, oldest to newest, for judging the base/trend shape):
{price_history_text}
News count: {len(news)}
News headlines (format: [source_tier] title (publisher, days offset from event, origin)):
{news_text}

Classify the setup type, apply the matching checklist, score catalyst strength, and build an
action plan. Return JSON with the exact structure specified in your instructions."""

    # Free analysis only: Gemini's free tier when GEMINI_API_KEY is set, otherwise (or on any
    # Gemini failure, e.g. the daily free quota running out) the rule engine in rules_analysis.py.
    market_data = MarketData(
        ticker=ticker, company_name=company_name, date_str=date_str,
        open=today_bar["o"], high=today_bar["h"], low=today_bar["l"], close=today_bar["c"],
        price_change_pct=price_change_pct, volume_ratio=volume_ratio,
        move_30d_pct=ytd_move_pct, move_90d_pct=move_90d_pct, high_90d=high_90d, low_90d=low_90d,
        ema21=ema21, sma50=sma50, market_cap=market_cap, lookback=lookback, news=news,
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        analysis, gemini_info = await analyze_with_gemini(client, SYSTEM_PROMPT, user_message)
    if analysis is not None:
        analysis_source, analysis_note = "gemini", f"Анализ: Google Gemini ({gemini_info}, бесплатный тариф)"
    else:
        analysis = analyze_with_rules(market_data)
        analysis_source = "rules"
        analysis_note = "Анализ: правила в коде (бесплатно)"
        if gemini_info != "GEMINI_API_KEY not set":
            analysis_note += f" — Gemini недоступен: {gemini_info}"

    # Deterministic scoring/verdict/sizing -- see the functions above for why this isn't left to
    # the LLM's own arithmetic.
    checklist_type = analysis.get("checklist_type") or "ep"
    setup_type = analysis.get("setup_type") or "EP"
    setup_score = compute_setup_score(checklist_type, analysis.get("checklist"))
    catalyst_strength = compute_catalyst_strength((analysis.get("catalyst_strength") or {}).get("dimensions"))
    verdict_strength, verdict_color = compute_verdict(setup_type, setup_score, catalyst_strength["total"])
    size = compute_size(verdict_strength, market_cap, today_bar["c"])

    analysis["setup_score"] = setup_score
    analysis["catalyst_strength"] = catalyst_strength
    analysis["combined_score"] = {
        "total": catalyst_strength["total"] + setup_score,
        "verdict_strength": verdict_strength,
    }
    analysis["verdict"] = coarse_verdict(verdict_strength)
    analysis["verdict_color"] = verdict_color
    action_plan = analysis.get("action_plan") or {}
    action_plan["size"] = size
    analysis["action_plan"] = action_plan
    if analysis_source == "rules":
        finalize_rules_analysis(analysis, market_data, setup_score, catalyst_strength["total"], analysis["verdict"])
    analysis["analysis_source"] = analysis_source
    analysis["analysis_note"] = analysis_note

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


@router.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(router)
app.include_router(router, prefix="/api")
