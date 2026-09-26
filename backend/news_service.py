"""News gathering for the EP analyzer: Massive's news endpoint first, with a Claude
web-search fallback when Massive comes up short (illiquid/small-cap tickers Massive's free
tier often has no press coverage for, even though the news genuinely exists elsewhere)."""

import json
import os
from datetime import date as date_cls
from datetime import timedelta
from typing import Optional

import httpx
from anthropic import AsyncAnthropic
from dotenv import load_dotenv

# Loaded independently of main.py's own load_dotenv() call, so MASSIVE_API_KEY below is populated
# regardless of import order (this module is imported by main.py before main.py calls load_dotenv()).
load_dotenv()

MASSIVE_API_KEY = os.environ.get("MASSIVE_API_KEY", "")
MASSIVE_BASE_URL = "https://api.massive.com"
CLAUDE_MODEL = "claude-sonnet-5"

# Used for both source-tier classification (surfaced to Claude in the analysis prompt) and web
# search source labeling. Substring match against the publisher name/domain, case-insensitive.
TIER_1_SOURCES = ["businesswire", "prnewswire", "globenewswire", "sec.gov"]
TIER_2_SOURCES = ["reuters", "bloomberg", "ft.com", "financial times"]
TIER_3_SOURCES = ["motleyfool", "fool.com", "seekingalpha", "seeking alpha"]


def classify_source_tier(source: Optional[str]) -> int:
    s = (source or "").lower()
    if any(t in s for t in TIER_1_SOURCES):
        return 1
    if any(t in s for t in TIER_2_SOURCES):
        return 2
    if any(t in s for t in TIER_3_SOURCES):
        return 3
    return 2  # unclassified sources default to moderate confidence, not automatically low or high


async def fetch_massive_news(client: httpx.AsyncClient, ticker: str, date_str: str) -> list[dict]:
    """News from Massive for date -1 to date +1 (a same-day-only window misses items Massive
    tags to the adjacent calendar day due to publish-time/timezone rounding)."""
    d = date_cls.fromisoformat(date_str)
    start = (d - timedelta(days=1)).isoformat()
    end = (d + timedelta(days=1)).isoformat()
    try:
        r = await client.get(
            f"{MASSIVE_BASE_URL}/v2/reference/news",
            params={
                "ticker": ticker,
                "published_utc.gte": f"{start}T00:00:00Z",
                "published_utc.lte": f"{end}T23:59:59Z",
                "limit": 10,
                "apiKey": MASSIVE_API_KEY,
            },
        )
        if not r.is_success:
            return []
        articles = (r.json() or {}).get("results") or []
    except httpx.RequestError:
        return []

    out = []
    for a in articles:
        publisher = (a.get("publisher") or {}).get("name") or ""
        out.append({
            "title": a.get("title"),
            "description": a.get("description"),
            "publisher": publisher,
            "url": a.get("article_url"),
            "source_tier": classify_source_tier(publisher),
            "origin": "massive",
        })
    return out


def _extract_json_loose(text: str) -> dict:
    """Same tolerant parsing as main.py's extract_json, plus a fallback that pulls out the
    {...} substring -- web search responses are more likely to have a stray sentence of
    narration around the JSON than the plain analysis call is."""
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if "\n" in text:
            first_line, rest = text.split("\n", 1)
            if first_line.strip().lower() in ("json", ""):
                text = rest
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise


async def fetch_web_search_news(
    anthropic_client: AsyncAnthropic, ticker: str, company_name: str, date_str: str
) -> list[dict]:
    """Fallback for when Massive has too little news -- asks Claude to search the web directly
    with a few targeted query variations. Never raises: any failure here just means the caller
    proceeds with whatever Massive already found (possibly nothing), which the analysis prompt
    is explicitly told not to treat as 'no catalyst'."""
    prompt = f"""Search for news about {ticker} ({company_name}) on {date_str}.
Try these searches:
1. "{ticker} stock news {date_str}"
2. "{company_name} press release {date_str}"
3. "{company_name} announcement {date_str}"

Respond with ONLY this JSON, no other text, no markdown fences:
{{"news": [{{"title": "...", "source": "...", "summary": "..."}}]}}
If you find nothing relevant to that specific date, respond with {{"news": []}}."""

    try:
        resp = await anthropic_client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1500,
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception:
        return []

    text_blocks = [b.text for b in resp.content if getattr(b, "type", None) == "text" and b.text]
    if not text_blocks:
        return []

    try:
        # Claude's synthesized answer (after any search narration) is the last text block.
        data = _extract_json_loose(text_blocks[-1])
    except (json.JSONDecodeError, ValueError):
        return []

    items = data.get("news") or []
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        source = it.get("source") or ""
        out.append({
            "title": it.get("title"),
            "description": it.get("summary"),
            "publisher": source,
            "url": None,
            "source_tier": classify_source_tier(source),
            "origin": "web_search",
        })
    return out


async def get_news(
    client: httpx.AsyncClient,
    anthropic_client: AsyncAnthropic,
    ticker: str,
    company_name: str,
    date_str: str,
) -> list[dict]:
    """Massive first; if it comes back with fewer than 2 items, top up with a Claude web search
    and combine both sets (Massive's items first, since they're the more structured source)."""
    news = await fetch_massive_news(client, ticker, date_str)
    if len(news) < 2:
        web_news = await fetch_web_search_news(anthropic_client, ticker, company_name, date_str)
        news = news + web_news
    return news
