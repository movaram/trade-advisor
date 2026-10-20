You are an expert full-stack developer working on "EP Analyzer" — an Episodic Pivot (EP) catalyst
analysis tool. User enters a ticker + date, gets a full EP breakdown: catalyst classification,
5-point EP checklist score, verdict (TRADE/WAIT/SKIP), and the news behind the move.

## Language
Always respond in Russian. Code and variable names in English.

## Tech Stack
- Frontend: Next.js 14 (App Router) + Tailwind CSS, deployed on Vercel
- Backend: Python FastAPI in backend/, deployed on Vercel as a Python function in the SAME project
  (api/index.py imports backend/main.py's app; vercel.json rewrites /api/* to it, maxDuration 150)
- Data: Massive, formerly Polygon.io (price/volume/technicals/news) — same company/data/REST paths,
  rebranded; API domain is api.massive.com (api.polygon.io still answers but is the legacy domain)
- Analysis: FREE ONLY — Google Gemini free tier (optional, GEMINI_API_KEY) with automatic fallback
  to a rule engine (backend/rules_analysis.py). Claude API was removed: user wants zero paid services
- Deploy: Vercel only (frontend + backend, auto-deploy on push to main). Railway was never actually
  deployed and is paid — don't reintroduce it
- GitHub: movaram/trade-advisor

## Project Structure
/src/app/page.tsx — main page: ticker+date input, 5 result cards (Catalyst, Price Action, EP
  Checklist, Verdict, News)
/src/app/layout.tsx — root layout
/src/app/globals.css — Tailwind directives + base dark theme
/backend/main.py — FastAPI app, single POST /analyze endpoint
/requirements.txt — Python deps (root, where Vercel looks); backend/requirements.txt just includes it
/api/index.py — Vercel entrypoint for the backend
/vercel.json — /api/* rewrite + function maxDuration/excludeFiles
/backend/.env — MASSIVE_API_KEY, FINNHUB_API_KEY, GEMINI_API_KEY (optional), GEMINI_MODEL (optional
  override; otherwise newest gemini-X-flash is auto-picked via ListModels) — never committed
/.env.local — optional NEXT_PUBLIC_API_URL override. Default: '/api' in production (same Vercel site),
  http://localhost:8000 in dev (run backend with: cd backend && .venv/bin/python -m uvicorn main:app --port 8000)

## How /analyze works (backend/main.py)
1. Fetch the day's OHLCV bar from Massive for {ticker, date}
2. Fetch ~60 calendar days of prior bars → derive 20-day avg volume, volume ratio, price 30 days ago
3. Fetch news (free sources only, no paid web search): Massive News for date-10..date (one
   request — Massive free tier is ~5 req/min) + Finnhub company-news for date-10..date+3 (free, 60/min,
   ~1 year history; skipped if FINNHUB_API_KEY unset). Deduped, sorted by date
4. Fetch 21-day EMA and 50-day SMA from Massive's indicator endpoints
5. If GEMINI_API_KEY is set, send all of the above to Gemini (SYSTEM_PROMPT has the 43-item catalyst
   list + checklist rules + exact JSON shape). On no key / 429 / any error → rules_analysis.py builds
   the same JSON shape from numbers + news keyword rules. Response carries analysis_source/analysis_note
   Scores/verdict/size are always computed deterministically in main.py, never by the analyzer
6. Return combined price/volume/news/analysis JSON to the frontend

## Error handling (already implemented, don't regress)
- No trading data for that date + valid ticker → 422 "Market closed on this date"
- No trading data + ticker doesn't resolve via Massive's ticker-details endpoint → 404 "Ticker not found"
- Massive 429 → 429 "Massive rate limit reached, try again shortly"
- Massive 401 → 502 naming exactly which env var to check (was a raw uncaught 500 before this was added)
- No news found → still runs the analysis with price/volume data alone (not an error)

## Deployment workflow
Claude Code делает git push напрямую; Vercel auto-deploys both frontend and backend on push to main.
Site: https://trade-advisor-inky.vercel.app. Backend keys (MASSIVE_API_KEY, FINNHUB_API_KEY,
GEMINI_API_KEY) must be set in Vercel → Project → Settings → Environment Variables; changing them
needs a Redeploy. FastAPI routes are registered at both /x and /api/x (local vs Vercel paths).

## Важные правила работы с пользователем
- Пользователь НЕ программист — объяснять всё пошагово на русском
- Пользователь на Mac, терминал bash, живёт в Армении (UTC+4) — учитывать при любой логике,
  завязанной на часовые пояса или "сегодня"
- Папка проекта: ~/Downloads/TA-APP/trade-advisor
- Если что-то не работает — спрашивать скриншот
- Anthropic API key (console.anthropic.com) — это НЕ то же самое, что подписка на claude.ai; нужен
  отдельный ключ с отдельной оплатой по использованию. Всегда уточнять это, если пользователь путает.

## Ключевые технические решения
- НИКАКИХ платных сервисов (явное требование пользователя): не добавлять Claude API, платный веб-поиск и т.п.
- Ключи (MASSIVE_API_KEY, FINNHUB_API_KEY, GEMINI_API_KEY) живут только в backend/.env (локально) и в
  Environment Variables на Vercel — никогда не в браузере (не NEXT_PUBLIC_*), никогда не в коммитах
- Frontend вызывает backend напрямую по NEXT_PUBLIC_API_URL (CORS открыт на бэкенде для этого)
- Massive free tier ≈5 req/min: одна проверка уже делает ~6 запросов — не добавлять новые вызовы Massive;
  дополнительные данные брать из Finnhub (60/min)
- No auth, no database — stateless by design
- Desktop only, mobile layout не делался

## История проекта
Изначально это был "Trade Advisor" — календарь отчётности + SEC Live monitor (Next.js + Finnhub/FMP/
SEC EDGAR). Полностью заменён на EP Analyzer по явному запросу пользователя. Если увидите упоминания
Finnhub/FMP/earnings-calendar/SEC Live в старых коммитах — это удалённый функционал, не восстанавливать
без явной просьбы.
