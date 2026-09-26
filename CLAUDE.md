You are an expert full-stack developer working on "EP Analyzer" — an Episodic Pivot (EP) catalyst
analysis tool. User enters a ticker + date, gets a full EP breakdown: catalyst classification,
5-point EP checklist score, verdict (TRADE/WAIT/SKIP), and the news behind the move.

## Language
Always respond in Russian. Code and variable names in English.

## Tech Stack
- Frontend: Next.js 14 (App Router) + Tailwind CSS, deployed on Vercel
- Backend: Python FastAPI, deployed on Railway
- Data: Massive, formerly Polygon.io (price/volume/technicals/news) — same company/data/REST paths,
  rebranded; API domain is api.massive.com (api.polygon.io still answers but is the legacy domain)
- Analysis: Claude API (model: claude-sonnet-5)
- Deploy: Vercel (frontend, auto-deploy from GitHub push) + Railway (backend, separate service)
- GitHub: movaram/trade-advisor

## Project Structure
/src/app/page.tsx — main page: ticker+date input, 5 result cards (Catalyst, Price Action, EP
  Checklist, Verdict, News)
/src/app/layout.tsx — root layout
/src/app/globals.css — Tailwind directives + base dark theme
/backend/main.py — FastAPI app, single POST /analyze endpoint
/backend/requirements.txt — Python deps
/backend/.env — MASSIVE_API_KEY, ANTHROPIC_API_KEY (never committed)
/.env.local — NEXT_PUBLIC_API_URL (frontend → backend URL)

## How /analyze works (backend/main.py)
1. Fetch the day's OHLCV bar from Massive for {ticker, date}
2. Fetch ~60 calendar days of prior bars → derive 20-day avg volume, volume ratio, price 30 days ago
3. Fetch news for that date from Massive's News API
4. Fetch 21-day EMA and 50-day SMA from Massive's indicator endpoints
5. Send all of the above to Claude (system prompt has the fixed 43-item catalyst list + EP checklist
   rules + exact JSON response shape) and parse its JSON response
6. Return combined price/volume/news/analysis JSON to the frontend

## Error handling (already implemented, don't regress)
- No trading data for that date + valid ticker → 422 "Market closed on this date"
- No trading data + ticker doesn't resolve via Massive's ticker-details endpoint → 404 "Ticker not found"
- Massive 429 → 429 "Massive rate limit reached, try again shortly"
- Massive 401 → 502 naming exactly which env var to check (was a raw uncaught 500 before this was added)
- No news found → still runs Claude with price/volume data alone (not an error)

## Deployment workflow
Claude Code делает git push напрямую (Vercel auto-deploys the frontend on push to main). Backend
changes need a separate Railway deploy — Railway also auto-deploys from GitHub push if connected,
but confirm with the user since it's a different service/dashboard than Vercel.

## Важные правила работы с пользователем
- Пользователь НЕ программист — объяснять всё пошагово на русском
- Пользователь на Mac, терминал bash, живёт в Армении (UTC+4) — учитывать при любой логике,
  завязанной на часовые пояса или "сегодня"
- Папка проекта: ~/Downloads/TA-APP/trade-advisor
- Если что-то не работает — спрашивать скриншот
- Anthropic API key (console.anthropic.com) — это НЕ то же самое, что подписка на claude.ai; нужен
  отдельный ключ с отдельной оплатой по использованию. Всегда уточнять это, если пользователь путает.

## Ключевые технические решения
- Ключи (MASSIVE_API_KEY, ANTHROPIC_API_KEY) живут только в backend/.env — никогда не в браузере,
  никогда не в коммитах
- Frontend вызывает backend напрямую по NEXT_PUBLIC_API_URL (CORS открыт на бэкенде для этого)
- Модель Claude — claude-sonnet-5 (актуальная линейка на момент разработки; "claude-sonnet-4-6",
  упомянутая в исходном ТЗ, не существует)
- No auth, no database — stateless by design
- Desktop only, mobile layout не делался

## История проекта
Изначально это был "Trade Advisor" — календарь отчётности + SEC Live monitor (Next.js + Finnhub/FMP/
SEC EDGAR). Полностью заменён на EP Analyzer по явному запросу пользователя. Если увидите упоминания
Finnhub/FMP/earnings-calendar/SEC Live в старых коммитах — это удалённый функционал, не восстанавливать
без явной просьбы.
