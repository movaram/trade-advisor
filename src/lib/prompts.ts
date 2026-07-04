// Prompt library sourced from "DeepVue Ai prompts" reference document.

export const AI_SYSTEM_PROMPT = `Ты — экспертный трейдинг-аналитик с многолетним опытом свинг-трейдинга (позиции держатся от 1 до 14 дней), макро-анализа и фундаментального анализа компаний. Ты даёшь чёткие, структурированные, ориентированные на трейдера ответы — по делу, без академической воды.

ВАЖНО: независимо от языка промпта, ВСЕГДА отвечай на русском языке. Форматируй ответ в markdown (заголовки, списки, таблицы), чтобы его было легко читать.`

export interface TickerPromptDef {
  id: string
  label: string
  needsDate?: boolean
  build: (ticker: string, date?: string) => string
}

export const TICKER_PROMPTS: TickerPromptDef[] = [
  {
    id: 'earnings-deep-dive',
    label: 'Earnings Deep Dive',
    build: (ticker) => `Analyze ${ticker}'s most recent earnings report in depth.
1. Start with a 4-sentence TLDR of the earnings report that covers:
- Overall quality of the quarter (beat/miss/mixed)
- Trajectory of growth (re-accelerating, stable, decelerating)
- Direction of margins and profitability
- How guidance and management tone affect the outlook for the next few quarters

2. Immediately after the TLDR, provide a concise metrics header, each on its own line (fill in values, or say "N/A" / "Not disclosed" if needed):
- Earnings Growth YoY
- Earnings Surprise vs Estimates
- Sales Growth YoY
- Sales Surprise vs Estimates
- Margins YoY (gross, operating, net — summarize direction and magnitude)
- Guidance Changes (raise / maintain / cut, and for what: revenue, EPS, margins, etc.)

3. Then expand using the sections below with no more than 20 bullets total across all sections (excluding the TLDR and metrics header). Focus only on what is truly important and material.

Revenue & Sales
- Summarize total revenue growth (YoY and, if notable, QoQ), including key segment or geographic trends.
- Note where growth is accelerating, stable, or slowing, and whether it beat or missed expectations.

Earnings & Profitability
- Describe EPS performance (YoY growth, beat/miss vs estimates) and main drivers (costs, mix, pricing, one-offs).
- Comment on the quality of earnings (recurring vs non-recurring, sustainable vs one-time).

Margins
- Explain what happened to gross, operating, and net margins YoY.
- Highlight the main drivers (input costs, operating leverage, product mix, pricing power, FX, etc.).

Capital Returns: Buybacks / Dividends
- Summarize any share repurchases, dividend changes, or new authorizations, including announcements from the past few months.
- Interpret what this signals about management's confidence and capital allocation priorities.

New Products, Developments & Strategic Moves
- Highlight important new products, features, partnerships, acquisitions, or strategic initiatives.
- Explain how these could impact revenue growth, margins, or competitive positioning over the next 1-3 years.

Guidance & Management Tone
- Detail any changes to guidance (revenue, EPS, margins, cash flow) vs prior guidance and vs consensus.
- Describe management's tone (confident, cautious, defensive, uncertain) and key comments on demand, macro, and competition.

Big Picture Takeaways for Investors/Traders
- Summarize the core positives and core risks/concerns from this report.
- Explain whether this quarter and guidance strengthen, confirm, or weaken the longer-term bull case for the company (no price targets needed).

Keep the writing clear, structured, and focused on what actually matters for future earnings power and how the market is likely to perceive the report.`,
  },
  {
    id: 'company-story',
    label: 'Company Story',
    build: (ticker) => `Give me a quick but detailed brief on ${ticker}.

Start with a 4-sentence TLDR that covers:
- What the company does in simple terms
- The main theme(s)/sectors it fits into (e.g., AI, semiconductors, fintech, biotech, etc.)
- Whether its growth/positioning looks early, mid, or mature
- Any recent potentially game-changing developments (products, deals, regulation, tech shifts, etc.)

Then expand with short sections and bullets:

1. What the Company Does (Plain English)
- One or two sentences explaining what they actually do and who their main customers are.
- Their core business model (how they make money).

2. Key Facts & Business Snapshot
- Market cap (approximate), primary listing, and main geography.
- Primary business segments or revenue streams (just the big buckets).
- Rough sense of growth profile (high growth / steady / low growth).

3. The Story Behind the Company
- Brief origin story: how they started and how the business has evolved.
- Important turning points (major pivots, acquisitions, product launches, crises, etc.).
- Where they stand now in their journey (disruptor, scaled leader, turnaround, etc.).

4. Themes & Narrative Positioning
- Which major themes they're part of (from a trader/investor lens), e.g. AI, cloud, cybersecurity, fintech, clean energy, EVs, biotech, infrastructure, consumer, etc.
- How they benefit from or are exposed to those themes (tailwinds and headwinds).

5. Recent Potentially Game-Changing Developments
- Any recent catalysts: new products, partnerships, regulatory approvals/risks, major contracts, M&A, or leadership changes.
- Why these might be game-changing (impact on growth, margins, moat, or risk).

6. Competitive Position & Moat (High Level)
- Who they mainly compete with (types of competitors or a few key names).
- Their edge or moat, if any (technology, brand, distribution, data, regulation, etc.).
- Any obvious vulnerabilities (regulatory, technological disruption, customer concentration, etc.).

7. Stock Price Performance
- Current performance YTD, over the last 3 months, and over the last month — be specific with numbers.
- Current status: trending or basing.
- Relative Strength versus the market and other stocks in its theme.

8. What Really Matters Going Forward
- 3-5 bullets on the key things investors/traders should watch (metrics, adoption, margins, regulation, competitive threats).
- One short closing sentence on what has to go right for the bullish story and what could break it.

Keep the tone clear, concise, and trader/investor-oriented, not overly academic.`,
  },
  {
    id: 'gap-up-catalyst',
    label: 'Gap-Up Catalyst',
    needsDate: true,
    build: (ticker, date) => `Explain why ${ticker} gapped up on ${date}.

Use the most relevant historical data and news you can access, and do the following:

1. Start with a 3-4 sentence TLDR that clearly states:
- The most likely primary catalyst for the gap (e.g., earnings beat, guidance, M&A, FDA news, macro/sector move, etc.)
- Whether the news was company-specific, sector-wide, or macro
- Roughly how big the move was (gap size & follow-through intraday, if possible)
- How the market interpreted the news (bullish, cautious, short-covering, relief rally, etc.)

2. Then expand using the sections below:

1. Price & Volume Context Around ${date}
- Briefly describe the gap size (approx. % from prior close to open) and volume vs normal on ${date}.
- Note whether price held, extended, or faded the gap intraday.
- Mention where this gap occurred relative to recent price action (e.g., out of a base, after a selloff, into resistance, near highs/lows).

2. Key News Headlines (Day Of & Day Before)
- List the most relevant headlines from ${date} and the prior trading day that could explain the move.
- For each, include: time (if available), source/type (e.g., "Earnings release", "Company press release", "Analyst upgrade", "Sector/ETF news", "Macro headline"), and a 1-sentence summary.
- Prioritize company-specific and sector-specific news over generic macro noise.

3. Catalyst Analysis & Likely Primary Driver
- From the headlines above, identify the most likely primary catalyst(s) for the gap on ${date}.
- Explain why that catalyst would plausibly cause a sharp gap up, considering: earnings vs expectations (revenue, EPS, guidance), new products/approvals/partnerships/contracts, M&A activity or strategic announcements, analyst upgrades/target hikes or rating changes, macro/sector events that specifically benefit this company.
- If multiple events occurred, rank them in order of probable impact and note if some news was likely secondary.

4. Market Interpretation & Follow-Through
- Describe how the broader market and sector were trading on ${date} (risk-on, risk-off, sector strength/weakness).
- Explain whether the reaction in the stock looked like a fundamental re-rating, a short-covering squeeze, a relief rally, or a more speculative/sentiment-driven spike.
- If possible, briefly comment on what happened in the days/weeks after the gap (did the move stick, build, or fade?).

Keep the answer focused on the most plausible catalysts and avoid over-emphasizing minor headlines that likely didn't move the stock.`,
  },
  {
    id: 'qualitative-score',
    label: 'Qualitative Score',
    build: (ticker) => `Qualify ${ticker} based on the 10 questions below. Give an answer Yes or No for each, where Yes = 1, No = 0. Then give the final rank (sum out of 10) and a short explanation for each answer.

1. Would it be hard to copy this company even if a competitor had unlimited money?
2. Do customers speak positively about the company and recommend its product?
3. Has the company survived past crises and shown resilience?
4. Does the company spend more on R&D than on marketing?
5. Do employees stay at the company for many years?
6. What would happen if the CEO left tomorrow? Is there a clear succession plan?
7. Does most of the revenue come from recurring sources or long-term contracts?
8. Does the company have pricing power? Can it raise prices without losing customers?
9. Have revenue and profits grown in the past 5 years? Is the growth steady or exponential?
10. Does the company have room to grow in the future? Is it in a growing industry with market share still to gain?

Present the result as a table: question number, short question, Yes/No, 1-2 sentence rationale. Finish with the total score out of 10 and a brief verdict on overall business quality.`,
  },
]

export interface MarketPromptDef {
  id: string
  label: string
  build: () => string
}

export const MARKET_PROMPTS: MarketPromptDef[] = [
  {
    id: 'pre-market',
    label: 'Pre-Market Events & Catalysts Brief',
    build: () => `You are my pre-market events scout. Using the most up-to-date information you can access, scan for scheduled events that could move markets.

If today is a trading day (Mon-Fri, non-holiday) → focus on today's events.
If today is a weekend or U.S. market holiday → focus on the next U.S. trading day, and clearly state the date you're covering.
Use U.S. Eastern Time (ET) for all times. Keep the answer short, scannable, and easy to read.

1. TLDR (Max 5 Bullets)
Start with a max 5-bullet TLDR that highlights:
- The most important data release(s) (e.g., CPI, NFP, PCE, ISM, GDP, jobless claims, etc.)
- Any key Fed events (FOMC meeting, minutes, major speeches)
- Any notable other central bank, political, or geopolitical events
- Whether the day looks like high-, medium-, or low-catalyst for volatility
- One line on what the market is most focused on for that session

2. Key Events Calendar (For Today or Next Trading Day)
Provide a compact markdown table of the main scheduled events for the covered session, with: Time (ET), Event name (e.g., "FOMC Minutes", "Fed Chair speech", "CPI (m/m, y/y)", "NFP Jobs Report"), Expected/consensus (if available), Importance (High/Medium/Low).
Include only events that can realistically move indices, yields, USD, or major sectors.
Also include a small Fed & central bank sub-section: FOMC meetings, minutes, press conferences; scheduled speeches from Fed Chair, governors, regional presidents; any major ECB/BoE/BoJ events likely to impact U.S. risk assets.

3. What Actually Matters (1-3 Short Bullets)
Explain why the top events matter — which specific numbers or wording markets are focused on, and how a hotter/colder data print or more/less hawkish tone would likely affect rate cut/hike expectations and risk assets (equities, growth vs defensives, credit, USD). Keep this very concise and trader-focused.

4. Quick "If/Then" Cheat Sheet
Finish with a 3-5 bullet if/then cheat sheet (e.g., "If CPI comes in above expectations, likely reaction is: ...", "If Fed commentary is more hawkish than expected, likely reaction is: ..."). Keep everything centered on index/sector/risk-on vs risk-off implications, not individual stock tips.

Verify the specific times of speeches and key events before responding — these are critical. Include all scheduled Fed Chair and Vice Chair speeches, testimony, and panel appearances regardless of time or format, including evening events. If Jerome Powell is scheduled to speak today, include it even outside market hours. Cover all Fed regional president speeches scheduled for the day, major economic data releases with times and consensus, earnings calls for mega-cap or heavily-traded stocks (AAPL, MSFT, NVDA, TSLA, etc.), key congressional testimony or regulatory hearings, and major corporate announcements or guidance changes.

The entire response should be readable in under 3 minutes, formatted with bullets/tables for quick pre-market or weekend planning.`,
  },
  {
    id: 'situational-awareness',
    label: 'Situational Awareness Daily Breakdown',
    build: () => `You are my situational awareness coach for short-term swing trading (typical holds 1-14 days). Use the OODA loop (Observe → Orient → Decide → Act) to break down the current market environment and tell me how I should trade today. Structure your answer with clear headings and concise bullet points.

1. Regime & 21EMA Check
- Identify the current market regime (e.g., uptrend, downtrend, choppy/sideways, corrective, risk-on, risk-off).
- For the main indexes (SPX/SPY, QQQ, IWM), for each tell me: whether price is above or below the 21-day EMA, whether the 21EMA is rising/flat/falling, and approximately how many days price has been on this side of the 21EMA.
- Summarize what this implies for short-term swing trading (1-5 day holds).

2. Situational Awareness via OODA Loop
Observe: describe current index behavior (recent trend, volatility, notable gaps or thrusts); comment on recent breadth and whether the environment feels constructive, deteriorating, or frothy.
Orient: classify the environment as "Breakout-friendly", "Short-friendly", or "Choppy / death-by-a-thousand-cuts"; note whether conditions favor aggressive risk-taking, normal risk, or defensive/capital preservation.
Decide: explicitly answer YES/MAYBE/NO with brief rationale for each: "Are breakouts likely to work for the next 3-5 days?", "Are pullbacks likely to work for the next 3-5 days?", "Are breakdowns/short setups likely to work for the next 3-5 days?", "Are gappers (earnings/news gaps) likely to work for the next 3-5 days?"
Act: translate into concrete guidance on suggested max exposure (e.g., 0-25%, 25-50%, 50-100%), whether to use margin, preferred setup types (breakouts / pullbacks / gappers / shorts / cash), and expected holding time.

3. Themes, Sectors & Capitalization
- Identify which themes and sectors are showing the strongest momentum and leadership.
- Note whether stocks near 52-week highs or lows are driving most of the strong moves, and whether large-, mid-, or small-cap names dominate.
- Explain what this implies for where to focus scans and watchlists, for longs and, if applicable, for shorts near highs or failed breakouts.

4. Practical Playbook for Today
Summarize everything into a practical, checklist-style playbook. Do not suggest any specific tickers; explain the reasoning and patterns to look for. Cover: Market Regime & 21EMA Summary; Breakouts (likely to work? what kind, how aggressive); Pullbacks (likely to work? ideal characteristics); Gappers (likely to work? which type to favor, risk management); Breakdowns/Shorts (likely to work? ideal setups); Risk Settings (exposure range, margin, stop tightening); Focus List Guidance (themes/sectors, cap size preference, notes on avoiding choppy "death by a thousand cuts").

Make the tone clear, direct, and actionable, not academic. Assume I'm an experienced swing trader who just needs a precise situational awareness briefing before the open.`,
  },
  {
    id: 'leading-themes',
    label: 'Finding Leading Themes (Monthly + Weekly Rotation)',
    build: () => `You are my trading themes analyst. Using the most up-to-date data you can access, give me an in-depth brief of the current top trading themes in the market. Focus on which themes are seeing fresh breakouts, clean setups, and strong trends, evaluated from both a current theme perspective (last ~1 month) and a developing/rotational perspective (last ~1 week).

Explicitly consider (among any others you find important): Silver Miners, Bitcoin Miners, Oil & Gas, Gold Miners, Semiconductors, Cybersecurity, Software, Quantum, AI, Social Media, Solar, Genomics, Utilities, Transports, Telecom, Real Estate, Aerospace, Industrials, Casinos, Materials, China Internet, Airlines, Robotics, Medical, Growth Stocks, Biotechnology, Home Construction, Banks, Steel, HealthCare, Retail, Bitcoin, EVs. Where useful, include other key themes not listed.

1. TLDR Theme Snapshot (5-7 Bullets Max)
- Which 2-4 themes are the clear current leaders (strong trends, frequent breakouts, good follow-through)?
- Which 1-3 themes are emerging or improving over just the last week?
- Which major themes are rolling over, getting choppy, or clearly lagging?
- Is leadership broad or narrow, and does it feel early-stage, mid-cycle, or late/frothy?

2. Current Leaders — Last Month View
For the top 5-8 themes based on the last month, cover for each: Trend Quality (trending strongly / grinding / extended and frothy; orderly vs sloppy), Breakouts & Setups (fresh breakouts and continuations vs failing pullbacks), Breadth Within the Theme (concentrated vs broad; cap-size driving the move). End with a summary of how durable current leadership looks.

3. Developing / Rotational Themes — Last Week View
Focus on themes that may not have led the full month but show notable improvement, fresh breakouts, or sharp relative strength over the last week. For each: describe what changed, note whether it looks like a potential new leadership leg, a short-lived reaction/oversold bounce, or a speculative blow-off, and point out any big-picture rotation.

4. Theme Scorecard & Buckets
Bucket the major themes into: A. Strong Leaders (Buy-the-dip / Breakout-friendly), B. Improving / Watch Closely, C. Neutral / Mixed, D. Weak / Avoid / Short Candidates. For each bucket, 1-2 short bullets on what defines their current state and how it's changed vs 1 month ago and 1 week ago.

5. Risk-On vs Risk-Off Through Themes
Explain whether the theme landscape looks clearly risk-on, clearly risk-off, or mixed/rotational/choppy. Highlight any tension (e.g., risk-on sectors leading but speculative names failing underneath).

6. Practical Takeaways for a Theme-Focused Swing Trader
Which 2-4 theme buckets should a swing trader focus on for long setups right now and why? Which themes suit breakout trades, pullbacks within uptrends, mean-reversion shorts/breakdowns, or complete avoidance? If leadership looks late/frothy, note warning signs to watch for.

Keep the tone clear, direct, and trader-oriented, connecting monthly and weekly theme behavior.`,
  },
  {
    id: 'macro-backdrop',
    label: 'Macro Backdrop, Fed, Liquidity & Key Events',
    build: () => `You are my macro backdrop analyst. Using the most up-to-date information you can access, give me a clear, trader-focused overview of the current macro environment.

Start with a 3-sentence TLDR covering: the current macro regime (growth + inflation + policy bias), the Fed's latest stance and direction of travel, and whether the backdrop is broadly supportive, neutral, or hostile for risk assets (equities/crypto).

1. Macro Regime Snapshot — growth + inflation regime, recent GDP/labor market trends, headline and core inflation trajectory, and how these are influencing risk appetite.

2. Fed Policy: Recent Actions & Key Statements — most recent FOMC decision (rate move, current range, QT/QE pace), most important recent public statements from the Fed Chair and other officials on inflation risk, labor market, financial conditions, and policy path; whether they lean hawkish, dovish, or cautiously neutral vs 1-3 months ago.

3. Rates, Cuts/Hikes Path & Market Expectations — current Fed funds rate, 2-year and 10-year yields; market expectations for rate cuts/hikes over the next 6-12 months; any gap between what the Fed signals and what the market prices in, and what that tension might mean for volatility.

4. Liquidity, Money Supply & Financial Conditions — recent trends in money supply (M2 or proxy), liquidity conditions (balance sheet, reverse repo, QT/QE narrative); whether financial conditions are tightening, easing, or stable; how this liquidity mix affects equities/growth stocks, credit markets, and crypto/high-beta assets.

5. Upcoming Macro Catalysts & What to Watch — list key upcoming events (next FOMC meeting(s), CPI/PCE, jobs reports, major Fed speeches, policy deadlines, geopolitical events) with dates, why each matters, what the market currently expects, and what surprises would mean for rate expectations, liquidity, and risk assets.

6. Trading / Risk-Taking Implications (Conceptual Only) — given the current macro + Fed + liquidity mix, is the environment more favorable for expanding risk, staying balanced, or playing defense? How would a more dovish + easing setup vs a more hawkish + tightening setup typically impact growth stocks, cyclicals, and crypto? Provide a short checklist of 3-5 key macro variables/events that would change the regime and signal dialing risk up or down.

Keep the tone clear, direct, and trader-oriented. Assume I'm an experienced swing trader who wants a professional, context-rich macro brief connecting Fed actions, inflation, rates, liquidity, and upcoming events to risk-taking decisions.`,
  },
  {
    id: 'sector-trend',
    label: 'Index & Sector Trend / Leadership Analysis',
    build: () => `You are my index and sector analysis coach for short- and intermediate-term swing trading. Using the most up-to-date data you can access, analyze the major U.S. market indexes (SPX/SPY, QQQ, IWM) and the primary sectors (XLK, XLY, XLC, XLI, XLF, XLE, XLU, XLV, XLB, XLRE, XLP, SMH/Semis, etc.).

Start with a 3-sentence TLDR summarizing: overall index trend and health, which sectors are currently leading/lagging, and whether the environment is more risk-on, risk-off, or choppy.

1. Index Trend Overview (SPX/SPY, QQQ, IWM) — for each index: whether price is above/below the 21EMA and 50SMA, whether those MAs are rising/flat/falling, whether recent action is trending or choppy/sideways; short-term (5-10 day) and intermediate (1 month/20 day) trend; note recent breakouts/breakdowns, failed moves, major gaps or thrusts; whether pullbacks look orderly/constructive or heavy/distribution-like. Conclude with 2-3 sentences on the overall index backdrop for swing trading.

2. Sector Trend Map (Current State) — for major sectors (Technology, Consumer Discretionary, Communication Services, Industrials, Financials, Energy, Utilities, Health Care, Materials, Real Estate, Staples, and Semiconductors): price vs 21EMA/50SMA, uptrend/downtrend/choppy, leadership quality/neutral/laggard. Rank into Leaders, Middle of the pack, Laggards. Summarize how concentrated or broad the leadership is.

3. Leadership Rotation: Last Month vs Last Week — compare sector behavior over the last month (~20 trading days) vs the last week (~5 trading days): which sectors led/lagged over each window, whether leadership was stable or rotating, which sectors accelerated or stalled in just the last week, and any notable risk-on/risk-off shifts. Finish with a short paragraph on how leadership evolved from the month to the week.

4. Risk-On vs Risk-Off Read — characterize the environment as risk-on, risk-off, or choppy/transition, and describe how aligned or misaligned the major indexes and leading sectors are.

5. Swing Trading Implications (Conceptual, No Stock Picks Needed) — when indexes/leaders trend above the 21EMA/50SMA, what does that mean for position sizing, aggressiveness, and holding periods? When action gets choppy around those MAs, how should a trader adapt? When sectors rotate, how should watchlists and scans shift? Give a concise checklist of how to adjust focus, risk, and expectations based on the index and sector picture.

Keep the tone clear, direct, and actionable. Assume I'm an experienced trader who wants a professional-grade, context-rich market brief starting with the 3-sentence TLDR, then the full reasoning in these sections.`,
  },
]
