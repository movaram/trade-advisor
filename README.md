# EP Analyzer

Episodic Pivot (EP) catalyst analyzer. Enter a ticker + date, get a full EP breakdown in ~30 seconds:
catalyst classification, EP checklist score, verdict (TRADE / WAIT / SKIP), and the news behind the move.

- **Frontend** — Next.js 14 + Tailwind CSS (`/` — this repo's root)
- **Backend** — Python FastAPI (`/backend`)
- **Data** — Massive (formerly Polygon.io) — price, volume, technicals, news
- **News** — Massive + Finnhub (both free)
- **Analysis** — free only: Google Gemini free tier (optional) with automatic fallback to a
  built-in rule engine (`backend/rules_analysis.py`). No paid services.

## 1. Get API keys (all free)

### Massive (free tier — 15-min delayed data, fine for analyzing past dates)
Polygon.io rebranded to **Massive** — same company, same data, new name/domain.
1. Go to https://massive.com/dashboard/signup and create a free account.
2. Your API key is at https://massive.com/dashboard/keys — copy it.

### Finnhub (free, ~1 year of company news)
Sign up at https://finnhub.io and copy the API key from the dashboard.

### Google Gemini (optional, free tier)
At https://aistudio.google.com click **Get API key**. Without it, the rule engine does the analysis.

## 2. Backend setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env` and paste your keys (see `.env.example`).

Run it:
```bash
uvicorn main:app --reload
```
Backend is now live at http://localhost:8000 (interactive docs at http://localhost:8000/docs).

## 3. Frontend setup

From the repo root:
```bash
npm install
cp .env.local.example .env.local
npm run dev
```
Open http://localhost:3000 — the frontend calls the backend at the URL in `.env.local`
(`NEXT_PUBLIC_API_URL`, defaults to `http://localhost:8000`).

## 4. Deploy (Vercel only, free)

Frontend and backend deploy together as one Vercel project: `api/index.py` runs the FastAPI app
from `backend/` as a Python function, and `vercel.json` sends every `/api/*` request to it.

1. In Vercel → **Project Settings → Environment Variables**, add `MASSIVE_API_KEY`,
   `FINNHUB_API_KEY` and (optional) `GEMINI_API_KEY`, for Production and Preview.
   Do **not** set `NEXT_PUBLIC_API_URL` — in production the site calls its own `/api`.
2. Push to `main` — Vercel redeploys automatically. After changing a variable, use
   **Deployments → ⋮ → Redeploy** so it takes effect.

## Error handling

The backend returns a clear message for each of these:
- **Weekend/holiday** (no trading data for that date) → "Market closed on this date"
- **Invalid ticker** → "Ticker not found"
- **No news found** → analysis still runs on price/volume data alone
- **Massive rate limit** → "Massive rate limit reached, try again shortly"
- **Bad/missing API key** → names exactly which env var to check

## Notes

- No auth, no database — stateless by design, matching the brief.
- Desktop only, no mobile layout was built.
- Analysis explanations are in Russian; UI labels are in English.
- Massive's REST paths are identical to Polygon.io's old ones (`/v2/aggs/...`, `/v2/reference/news`,
  `/v1/indicators/...`) — only the domain changed, from `api.polygon.io` to `api.massive.com`.
