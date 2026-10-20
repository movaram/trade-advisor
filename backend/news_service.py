"""News gathering for the EP analyzer, from free sources only: Massive's and Finnhub's news
endpoints, merged and deduplicated."""

import asyncio
import os
from datetime import date as date_cls
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from dotenv import load_dotenv

# Loaded independently of main.py's own load_dotenv() call, so the API keys below are populated
# regardless of import order (this module is imported by main.py before main.py calls load_dotenv()).
load_dotenv()

MASSIVE_API_KEY = os.environ.get("MASSIVE_API_KEY", "")
MASSIVE_BASE_URL = "https://api.massive.com"
FINNHUB_API_KEY = os.environ.get("FINNHUB_API_KEY", "")
FINNHUB_BASE_URL = "https://finnhub.io/api/v1"

# Window searched around the event date: far enough back to catch a Delayed Episodic Pivot (news
# days ago, stock only reacting now), a few days forward to catch follow-up coverage that explains
# the move after the fact.
DAYS_BEFORE = 10
DAYS_AFTER = 3
# Per-source caps, split around the event date. Big caps get 100+ articles on a move day, so a
# single newest-first query would be all post-move commentary and miss the pre-move news (often the
# actual catalyst, released the evening before). Each side keeps the items closest to the event.
MAX_ITEMS_BEFORE = 15
MAX_ITEMS_FROM_EVENT_DAY = 20  # Massive: event day only (its window ends there)
MAX_ITEMS_EVENT_DAY = 15  # Finnhub: event day ...
MAX_ITEMS_AFTER = 5  # ... and the post-move days, capped separately so the event day can't crowd them out

# Used for source-tier classification (surfaced to Claude in the analysis prompt). Substring match against the publisher name/domain, case-insensitive.
TIER_1_SOURCES = ["businesswire", "prnewswire", "globenewswire", "sec.gov"]
TIER_2_SOURCES = ["reuters", "bloomberg", "ft.com", "financial times"]
TIER_3_SOURCES = ["motleyfool", "motley fool", "fool.com", "seekingalpha", "seeking alpha"]


def classify_source_tier(source: Optional[str]) -> int:
    s = (source or "").lower()
    if any(t in s for t in TIER_1_SOURCES):
        return 1
    if any(t in s for t in TIER_2_SOURCES):
        return 2
    if any(t in s for t in TIER_3_SOURCES):
        return 3
    return 2  # unclassified sources default to moderate confidence, not automatically low or high


async def _fetch_massive_range(
    client: httpx.AsyncClient, ticker: str, start: str, end: str, order: str, limit: int
) -> list[dict]:
    try:
        r = await client.get(
            f"{MASSIVE_BASE_URL}/v2/reference/news",
            params={
                "ticker": ticker,
                "published_utc.gte": f"{start}T00:00:00Z",
                "published_utc.lte": f"{end}T23:59:59Z",
                "sort": "published_utc",
                "order": order,
                "limit": limit,
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
        published_utc = a.get("published_utc") or ""
        out.append({
            "title": a.get("title"),
            "description": a.get("description"),
            "publisher": publisher,
            "url": a.get("article_url"),
            "source_tier": classify_source_tier(publisher),
            "origin": "massive",
            "published_date": published_utc[:10] or None,
        })
    return out


async def fetch_massive_news(client: httpx.AsyncClient, ticker: str, date_str: str) -> list[dict]:
    """News from Massive for DAYS_BEFORE days up to and including the event day, newest first --
    one request, since Massive's free tier allows only ~5 requests/minute and an analysis already
    spends most of that on price data. Post-move coverage (the DAYS_AFTER side) comes from
    Finnhub, whose free tier is far less tight."""
    d = date_cls.fromisoformat(date_str)
    news = await _fetch_massive_range(
        client, ticker, (d - timedelta(days=DAYS_BEFORE)).isoformat(), d.isoformat(), "desc", 50
    )
    return _split_around_event(news, d)


async def _fetch_finnhub_range(client: httpx.AsyncClient, ticker: str, start: date_cls, end: date_cls) -> list[dict]:
    try:
        r = await client.get(
            f"{FINNHUB_BASE_URL}/company-news",
            params={"symbol": ticker, "from": start.isoformat(), "to": end.isoformat(), "token": FINNHUB_API_KEY},
        )
        if not r.is_success:
            return []
        articles = r.json() or []
    except (httpx.RequestError, ValueError):
        return []
    if not isinstance(articles, list):
        return []

    out = []
    for a in articles:
        ts = a.get("datetime")
        published_date = (
            datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat() if isinstance(ts, (int, float)) and ts > 0 else None
        )
        source = a.get("source") or ""
        if not a.get("headline") or not published_date:
            continue
        out.append({
            "title": a.get("headline"),
            "description": a.get("summary") or None,
            "publisher": source,
            "url": a.get("url"),
            "source_tier": classify_source_tier(source),
            "origin": "finnhub",
            "published_date": published_date,
            "_ts": ts,  # for ordering within a day; dropped before returning
        })
    return out


async def fetch_finnhub_news(client: httpx.AsyncClient, ticker: str, date_str: str) -> list[dict]:
    """Company news from Finnhub's free tier (about 1 year of history, North American tickers).
    Skipped silently if FINNHUB_API_KEY isn't set -- it's an optional second free source.

    Finnhub returns at most ~250 of the NEWEST articles per request, and a big cap can get 200+
    on the move day alone, so one request over the whole window would only ever show the last day
    or two. Instead it's three requests (well within the 60/min free limit): the days before
    (newest kept -- the catalyst is usually the evening before), the event day (earliest kept),
    and the days after (earliest kept)."""
    if not FINNHUB_API_KEY:
        return []
    d = date_cls.fromisoformat(date_str)
    before, event_day, after = await asyncio.gather(
        _fetch_finnhub_range(client, ticker, d - timedelta(days=DAYS_BEFORE), d - timedelta(days=1)),
        _fetch_finnhub_range(client, ticker, d, d),
        _fetch_finnhub_range(client, ticker, d + timedelta(days=1), d + timedelta(days=DAYS_AFTER)),
    )
    by_time = lambda n: n["_ts"]
    news = (
        sorted(before, key=by_time, reverse=True)[:MAX_ITEMS_BEFORE]
        + sorted(event_day, key=by_time)[:MAX_ITEMS_EVENT_DAY]
        + sorted(after, key=by_time)[:MAX_ITEMS_AFTER]
    )
    for n in news:
        n.pop("_ts")
    return news


def _split_around_event(news: list[dict], event_date: date_cls) -> list[dict]:
    """Keep the MAX_ITEMS_BEFORE pre-event items and MAX_ITEMS_FROM_EVENT_DAY event-day-onward
    items closest to the event date."""
    news = [n for n in news if n.get("published_date")]
    event = event_date.isoformat()
    before = sorted((n for n in news if n["published_date"] < event), key=lambda n: n["published_date"], reverse=True)
    from_event = sorted((n for n in news if n["published_date"] >= event), key=lambda n: n["published_date"])
    return before[:MAX_ITEMS_BEFORE] + from_event[:MAX_ITEMS_FROM_EVENT_DAY]


def _dedupe(news: list[dict]) -> list[dict]:
    """Massive and Finnhub often carry the same wire story; keep the first copy of each headline
    (Massive first, since it's queried first and usually has the richer description)."""
    seen = set()
    out = []
    for n in news:
        key = "".join(ch for ch in (n.get("title") or "").lower() if ch.isalnum())[:80]
        if key and key in seen:
            continue
        seen.add(key)
        out.append(n)
    return out


async def get_news(client: httpx.AsyncClient, ticker: str, date_str: str) -> list[dict]:
    """Free sources only -- Massive, then Finnhub -- over the DAYS_BEFORE..DAYS_AFTER window
    (wide enough to catch a delayed reaction to older news for DEP detection), deduplicated and
    sorted by publication date. There's deliberately no paid fallback (the earlier Claude web
    search was removed to keep news gathering free); if both feeds come up empty the analysis
    prompt is told not to treat that as 'no catalyst'."""
    news = await fetch_massive_news(client, ticker, date_str)
    news = _dedupe(news + await fetch_finnhub_news(client, ticker, date_str))
    news.sort(key=lambda n: n.get("published_date") or "")
    return news
