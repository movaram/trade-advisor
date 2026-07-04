# Trade Advisor

Swing trading research tool — fundamentals, SEC filings, news, catalyst scanner.

## Data sources
- **Finnhub** — fundamentals, news, sentiment, insiders, analyst recommendations
- **SEC EDGAR** — 8-K, 10-Q, 10-K, Form 4 filings (free, no key needed)
- **Massive / Polygon** — market data (optional for future price features)

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Run locally
```bash
npm run dev
```
Open http://localhost:3000

### 3. Deploy to Vercel
1. Push this folder to a GitHub repository
2. Go to vercel.com → New Project → Import your repo
3. Click Deploy — done

No environment variables needed. API keys are entered in the app UI and stay in your browser only.

## Features
- **Trade checker** — full analysis per ticker: catalysts, fundamentals, insiders, news, SEC filings, verdict
- **Catalyst scanner** — scan up to 15 tickers at once, sorted by catalyst strength
- **SEC monitor** — browse recent filings by ticker
