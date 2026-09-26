# EP Analyzer

Episodic Pivot (EP) catalyst analyzer. Enter a ticker + date, get a full EP breakdown in ~30 seconds:
catalyst classification, EP checklist score, verdict (TRADE / WAIT / SKIP), and the news behind the move.

- **Frontend** — Next.js 14 + Tailwind CSS (`/` — this repo's root)
- **Backend** — Python FastAPI (`/backend`)
- **Data** — Polygon.io (price, volume, technicals, news)
- **Analysis** — Claude API (`claude-sonnet-5`)

## 1. Get API keys

### Polygon.io (free tier — 15-min delayed data, fine for analyzing past dates)
1. Go to https://polygon.io/dashboard/signup and create a free account.
2. Once logged in, your API key is on the dashboard home page — copy it.

### Anthropic (Claude API)
This is **not** the same as your claude.ai subscription — Claude Pro/Max does not include API access.
You need a separate account with its own billing:
1. Go to https://console.anthropic.com and sign up (or log in).
2. Add a payment method under **Settings → Billing** (API usage is billed per token; a few dollars
   covers a lot of testing).
3. Go to **API Keys** → **Create Key**, copy it.

## 2. Backend setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env` and paste your two keys:
```
POLYGON_API_KEY=your_polygon_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
```

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

## 4. Deploy

### Backend → Railway
1. Go to https://railway.app, sign up, **New Project → Deploy from GitHub repo**, pick this repo.
2. Set the service's **Root Directory** to `backend`.
3. Under **Variables**, add `POLYGON_API_KEY` and `ANTHROPIC_API_KEY` (same values as your local `.env`).
4. Railway auto-detects the Python app; if it asks for a start command, use:
   `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Once deployed, copy the public URL Railway gives the service (something like
   `https://your-app.up.railway.app`).

### Frontend → Vercel
1. This repo's root is already the Vercel project (same setup as before).
2. In Vercel → **Project Settings → Environment Variables**, add:
   `NEXT_PUBLIC_API_URL = https://your-app.up.railway.app` (the Railway URL from above).
3. Push to `main` — Vercel redeploys automatically.

## Error handling

The backend returns a clear message for each of these:
- **Weekend/holiday** (no trading data for that date) → "Market closed on this date"
- **Invalid ticker** → "Ticker not found"
- **No news found** → analysis still runs on price/volume data alone
- **Polygon rate limit** → "Polygon rate limit reached, try again shortly"

## Notes

- No auth, no database — stateless by design, matching the brief.
- Desktop only, no mobile layout was built.
- All Claude-generated explanations are in Russian; UI labels are in English.
