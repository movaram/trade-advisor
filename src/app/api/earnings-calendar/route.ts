import { NextRequest, NextResponse } from 'next/server'

// SEC calls (companyfacts payloads run 1-3MB each) take longer than the old all-Finnhub version.
// Default serverless timeout (10s) isn't enough headroom on a busy earnings day; this raises it.
export const maxDuration = 60

const SEC_AGENT = 'TradeAdvisor movaram@proton.me'

// US earnings calendars run on US Eastern Time regardless of where this server or its users are --
// 'en-CA' formats as YYYY-MM-DD directly, and the America/New_York zone handles EST/EDT automatically.
function usEasternDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

// Enrichment costs 2 Finnhub calls (market cap, historical EPS surprise%) + 1 SEC call (EPS/Sales
// history) per symbol that isn't already in the client's cache (see CLIENT_CACHE_TTL_MS below) --
// batched to stay polite to both providers, Finnhub's 60/min limit and SEC's ~10 req/sec fair-use
// guidance. Only the first load of the day actually pays this cost for a given symbol; every refresh
// after that serves cached symbols for free.
//
// MAX_ENRICH_LOOKUPS was briefly 60 with 4 Finnhub calls/symbol (adding stock/metric + quote for
// RS/52-week) -- that pushed a full first-load burst to ~240 Finnhub calls in well under a minute,
// 4x the 60/min limit, and it didn't just leave the new fields blank: it burned through enough of the
// rate-limit budget that even the plain calendar call on the *next* auto-refresh started failing,
// collapsing the whole list from 150+ companies down to 2.
//
// Second attempt capped the RS/52-week extras to the first MAX_RS_LOOKUPS symbols -- but with
// MAX_RS_LOOKUPS=10 equal to the batch size, ALL of them landed in batch 1 (10 x 4 = 40 calls fired
// at once), which was still enough to cost some of those symbols their *core* enrichment too (market
// cap, growth%), even though core-only batches right after it were fine. Worse: MAX_ENRICH_LOOKUPS
// picked a fixed *prefix* of that day's symbols every single request -- so whichever symbols landed
// late enough to get rate-limited stayed permanently blank all day (every refresh re-tried the exact
// same doomed tail), while the same early symbols kept "succeeding" for free once cached. Symptom:
// the same ~9 tickers always had data, the same ~17 never did, across many refreshes.
//
// MAX_ENRICH_LOOKUPS now caps *fresh* (not-yet-cached) enrichment per request, not total symbols.
// Already-cached symbols are always served for free regardless of count; only the fresh subset costs
// API calls, and that subset is small enough to stay safely under Finnhub's limit. A busy day's full
// coverage completes gradually over a few auto-refresh cycles -- each one enriches the next batch of
// still-uncached symbols -- rather than trying (and partially failing) to do everything in one shot.
const MAX_ENRICH_LOOKUPS = 10
const MAX_RS_LOOKUPS = 3

// A single slow upstream response (SEC companyfacts payloads run 1-3MB and occasionally stall) could
// otherwise hold up an entire batch and push the whole request toward -- or past -- its time limit,
// which comes back to the browser as a raw platform error page instead of JSON ("Unexpected token
// 'A', 'An error o...'"). Capping each individual fetch means one slow symbol degrades gracefully
// (that one field comes back null) instead of jeopardizing the whole response.
const FETCH_TIMEOUT_MS = 8000
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fhJson(url: string) {
  try {
    const r = await fetchWithTimeout(url)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

async function fmpJson(url: string) {
  try {
    const r = await fetchWithTimeout(url)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

function growthPct(current: number | null | undefined, prior: number | null | undefined) {
  if (current == null || prior == null || prior === 0) return null
  return ((current - prior) / Math.abs(prior)) * 100
}

// Finnhub's stock/metric?metric=all (Basic Financials, free tier) includes both 52-week range and
// pre-computed price-vs-S&P500 relative strength -- undocumented on their rendered docs site (which
// only shows a partial example), but confirmed against real API responses shared in Finnhub's own
// GitHub issue tracker. Field names below match that. If Finnhub ever renames these, the numbers
// degrade to null (shown as "—") rather than breaking anything.
function num(v: any): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null
}
function extractBasicMetrics(basicFinancials: any) {
  const m = basicFinancials?.metric || {}
  return {
    week52High: num(m['52WeekHigh']),
    week52Low: num(m['52WeekLow']),
    fiveDayReturnPct: num(m['5DayPriceReturnDaily']),
    rsMonthPct: num(m['priceRelativeToS&P5004Week']),
  }
}

// Revenue isn't a single standardized XBRL tag -- it varies by industry (a REIT reports "net
// interest income", a bank "noninterest income", a normal company "net sales"/"revenues"). This
// tries the common tags in priority order; it won't be perfect for every company, but covers the
// vast majority for free.
const REVENUE_CONCEPTS = [
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
  'SalesRevenueServicesNet',
  'InterestAndDividendIncomeOperating',
  'InterestIncomeExpenseNet',
  'NoninterestIncome',
  'TotalRevenuesAndOtherIncome',
]
const EPS_CONCEPTS = ['EarningsPerShareDiluted', 'EarningsPerShareBasic']

// --- SEC EDGAR XBRL: ticker -> CIK lookup, cached in-module for the life of the serverless instance ---
let tickerCikCache: { map: Map<string, string>; ts: number } | null = null
const TICKER_CIK_TTL_MS = 24 * 60 * 60 * 1000

async function getTickerCikMap(): Promise<Map<string, string>> {
  if (tickerCikCache && Date.now() - tickerCikCache.ts < TICKER_CIK_TTL_MS) return tickerCikCache.map
  try {
    const r = await fetchWithTimeout('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': SEC_AGENT } })
    if (!r.ok) return tickerCikCache?.map || new Map()
    const data = await r.json()
    const map = new Map<string, string>()
    Object.values(data as any).forEach((entry: any) => {
      if (entry?.ticker && entry?.cik_str != null) {
        map.set(String(entry.ticker).toUpperCase(), String(entry.cik_str).padStart(10, '0'))
      }
    })
    tickerCikCache = { map, ts: Date.now() }
    return map
  } catch {
    return tickerCikCache?.map || new Map()
  }
}

async function fetchSecFacts(cik: string) {
  try {
    const r = await fetchWithTimeout(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { 'User-Agent': SEC_AGENT } })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

// company_tickers.json occasionally points a ticker at a CIK with zero XBRL facts -- observed live
// for XOM, which the static file currently maps to a freshly-created holding-company CIK that has
// never filed anything, while the real 10-Q/10-K history still lives under Exxon's original CIK.
// browse-edgar's ticker resolution stays in sync with actual filers, so it's used as a fallback only
// when the primary lookup comes back empty (keeps this to one extra SEC call for the rare mismatch).
async function resolveCikViaBrowseEdgar(ticker: string): Promise<string | null> {
  try {
    const r = await fetchWithTimeout(
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=10-K&dateb=&owner=include&count=1&output=atom`,
      { headers: { 'User-Agent': SEC_AGENT } }
    )
    if (!r.ok) return null
    const text = await r.text()
    const m = text.match(/<cik>(\d+)<\/cik>/)
    return m ? m[1].padStart(10, '0') : null
  } catch { return null }
}

async function fetchSecFactsForSymbol(symbol: string, cik: string | undefined) {
  let facts = cik ? await fetchSecFacts(cik) : null
  const hasUsGaap = Object.keys(facts?.facts?.['us-gaap'] || {}).length > 0
  if (!hasUsGaap) {
    const fallbackCik = await resolveCikViaBrowseEdgar(symbol)
    if (fallbackCik && fallbackCik !== cik) facts = await fetchSecFacts(fallbackCik)
  }
  return facts
}

// SEC's own internal filing-review office grouping -- coarser than GICS (only ~10 buckets, e.g.
// "06 Technology", "02 Finance", "01 Energy & Transportation"), but it's a genuine free sector
// classification. Finnhub's finnhubIndustry (already fetched via profile2) stays as the more granular
// "Industry" field; this is the broader "Sector" on top of it.
async function fetchSecSector(cik: string): Promise<string | null> {
  try {
    const r = await fetchWithTimeout(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { 'User-Agent': SEC_AGENT } })
    if (!r.ok) return null
    const d = await r.json()
    return typeof d?.ownerOrg === 'string' ? d.ownerOrg.replace(/^\d+\s*/, '') : null
  } catch { return null }
}

function spanDays(item: any): number | null {
  if (!item.start || !item.end) return null
  const s = new Date(item.start).getTime()
  const e = new Date(item.end).getTime()
  if (Number.isNaN(s) || Number.isNaN(e)) return null
  return (e - s) / (1000 * 60 * 60 * 24)
}

// SEC tags both the discrete 3-month figure AND the cumulative year-to-date figure (e.g. Jan-Sep)
// under the *same* concept/fy/fp -- they only differ by `start` date. Filtering by span picks out
// the discrete one. Facts also get re-filed with each subsequent quarter's comparatives, producing
// duplicate entries for the same `end` date; keep whichever was filed earliest (the as-first-reported
// value), matching what O'Neil/Bonde-style analysis expects.
function extractSeriesByEnd(facts: any, concepts: string[], predicate: (item: any) => boolean): Map<string, any> {
  for (const concept of concepts) {
    const unitsObj = facts?.facts?.['us-gaap']?.[concept]?.units
    if (!unitsObj) continue
    for (const unitKey of Object.keys(unitsObj)) {
      const items = (unitsObj[unitKey] as any[]).filter(
        (it) => typeof it.val === 'number' && it.fy != null && it.fp && it.end && predicate(it)
      )
      if (items.length === 0) continue
      const byEnd = new Map<string, any>()
      items.forEach((it) => {
        const existing = byEnd.get(it.end)
        if (!existing || (it.filed && existing.filed && it.filed < existing.filed)) byEnd.set(it.end, it)
      })
      return byEnd
    }
  }
  return new Map()
}

const FP_TO_QUARTER: Record<string, number> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 }
const isDiscreteQuarter = (it: any) => {
  const d = spanDays(it)
  return it.fp !== 'FY' && d != null && d >= 80 && d <= 100
}
const isAnnual = (it: any) => {
  const d = spanDays(it)
  return it.fp === 'FY' && d != null && d >= 350 && d <= 380
}
// 10-Ks report the full fiscal year, not a standalone Q4 -- SEC has no discrete Q4 XBRL fact for
// most companies. This catches the Jan-Sep cumulative figure (same concept/fy, fp still tagged 'Q3')
// so Q4 can be derived as FY minus 9mo, same as the pre-SEC Finnhub-based approach did.
const isCumulative9mo = (it: any) => {
  const d = spanDays(it)
  return it.fp === 'Q3' && d != null && d >= 260 && d <= 285
}

function seriesByFy(mapByEnd: Map<string, any>): Map<number, any> {
  const m = new Map<number, any>()
  mapByEnd.forEach((it) => m.set(it.fy, it))
  return m
}

function buildQuartersFromFacts(facts: any) {
  const epsByEnd = extractSeriesByEnd(facts, EPS_CONCEPTS, isDiscreteQuarter)
  const revByEnd = extractSeriesByEnd(facts, REVENUE_CONCEPTS, isDiscreteQuarter)
  const ends = new Set<string>()
  epsByEnd.forEach((_, k) => ends.add(k))
  revByEnd.forEach((_, k) => ends.add(k))
  const quarters = Array.from(ends).map((end) => {
    const epsItem = epsByEnd.get(end)
    const revItem = revByEnd.get(end)
    const src = epsItem || revItem
    return {
      date: end as string,
      year: src.fy as number,
      quarter: FP_TO_QUARTER[src.fp] ?? null,
      eps: epsItem?.val ?? null,
      revenue: revItem?.val ?? null,
    }
  })

  const epsAnnualByFy = seriesByFy(extractSeriesByEnd(facts, EPS_CONCEPTS, isAnnual))
  const revAnnualByFy = seriesByFy(extractSeriesByEnd(facts, REVENUE_CONCEPTS, isAnnual))
  const eps9moByFy = seriesByFy(extractSeriesByEnd(facts, EPS_CONCEPTS, isCumulative9mo))
  const rev9moByFy = seriesByFy(extractSeriesByEnd(facts, REVENUE_CONCEPTS, isCumulative9mo))
  const existingQ4Years = new Set(quarters.filter(q => q.quarter === 4).map(q => q.year))
  const allFy = new Set<number>()
  epsAnnualByFy.forEach((_, fy) => allFy.add(fy))
  revAnnualByFy.forEach((_, fy) => allFy.add(fy))
  allFy.forEach((fy) => {
    if (existingQ4Years.has(fy)) return
    const epsA = epsAnnualByFy.get(fy), revA = revAnnualByFy.get(fy)
    const eps9 = eps9moByFy.get(fy), rev9 = rev9moByFy.get(fy)
    const epsVal = (epsA && eps9) ? epsA.val - eps9.val : null
    const revVal = (revA && rev9) ? revA.val - rev9.val : null
    if (epsVal == null && revVal == null) return
    const dateSrc = epsA || revA
    quarters.push({ date: dateSrc.end, year: fy, quarter: 4, eps: epsVal, revenue: revVal })
  })

  quarters.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  return quarters
}

function buildAnnualFromFacts(facts: any) {
  const epsByEnd = extractSeriesByEnd(facts, EPS_CONCEPTS, isAnnual)
  const revByEnd = extractSeriesByEnd(facts, REVENUE_CONCEPTS, isAnnual)
  const ends = new Set<string>()
  epsByEnd.forEach((_, k) => ends.add(k))
  revByEnd.forEach((_, k) => ends.add(k))
  const years = Array.from(ends).map((end) => {
    const epsItem = epsByEnd.get(end)
    const revItem = revByEnd.get(end)
    const src = epsItem || revItem
    return { date: end as string, year: src.fy as number, eps: epsItem?.val ?? null, revenue: revItem?.val ?? null }
  })
  years.sort((a, b) => b.year - a.year)
  return years
}

// William O'Neil (CANSLIM) / Pradeep Bonde (Stockbee)-style table: each quarter's EPS and Sales
// compared to the *same fiscal quarter one year earlier* (the primary view -- most businesses are
// seasonal, so sequential QoQ is noisy). QoQ is also computed and kept as a separate field so the UI
// can offer it as an alternate view without blending the two into one ambiguous %. Matched via SEC's
// own fy/fp tags rather than calendar-quarter math, so it's correct even for non-calendar fiscal years.
function withGrowth(discrete: ReturnType<typeof buildQuartersFromFacts>) {
  return discrete.map((q, i) => {
    const priorYoy = discrete.find((x) => x.year === q.year - 1 && x.quarter === q.quarter)
    const priorQoq = discrete[i + 1] // next entry in date-desc order = immediately preceding quarter
    return {
      date: q.date,
      year: q.year,
      quarter: q.quarter,
      eps: q.eps,
      revenue: q.revenue,
      epsYoyPct: priorYoy ? growthPct(q.eps, priorYoy.eps) : null,
      revenueYoyPct: priorYoy ? growthPct(q.revenue, priorYoy.revenue) : null,
      epsQoqPct: priorQoq ? growthPct(q.eps, priorQoq.eps) : null,
      revenueQoqPct: priorQoq ? growthPct(q.revenue, priorQoq.revenue) : null,
      epsSurprisePct: null as number | null, // filled in from Finnhub stock/earnings where available
    }
  })
}

// Finnhub's stock/earnings gives actual/estimate/surprisePercent directly, but free tier hard-caps
// this at the last ~4 quarters regardless of params -- so most of the 8-quarter table won't have it.
// No free source (SEC included) carries historical *revenue* estimates, so there's no revenue-surprise
// equivalent for the history table; today's own report still gets both from the calendar endpoints.
function attachEpsSurprise(quarters: ReturnType<typeof withGrowth>, finnhubEarnings: any[]) {
  const byPeriod = new Map<string, number>()
  finnhubEarnings.forEach((r: any) => {
    if (r?.period && typeof r.surprisePercent === 'number') byPeriod.set(r.period, r.surprisePercent)
  })
  return quarters.map((q) => ({ ...q, epsSurprisePct: q.date ? byPeriod.get(q.date) ?? null : null }))
}

function annualWithYoy(years: ReturnType<typeof buildAnnualFromFacts>) {
  return years.map((y, i) => {
    const prior = years[i + 1]
    return {
      date: y.date,
      year: y.year,
      eps: y.eps,
      revenue: y.revenue,
      epsYoyPct: prior ? growthPct(y.eps, prior.eps) : null,
      revenueYoyPct: prior ? growthPct(y.revenue, prior.revenue) : null,
    }
  })
}

// Find the quarter closest to one year before `reportDate`, used to compute the main row's own
// growth% even before that exact quarter has been formally filed (the 10-Q/10-K lags the earnings
// announcement by several weeks). This can occasionally compare the earnings calendar's adjusted
// "actual" EPS against a GAAP prior-year figure -- usually a close enough approximation, but can be
// noisy for companies with large one-time GAAP charges (see the EPS disclaimer in the UI).
function findYoyMatch(reportDate: string, quarters: { date: string | null }[]) {
  const t = new Date(reportDate)
  let best: any = null, bestDiff = Infinity
  for (const q of quarters) {
    if (!q.date) continue
    const qd = new Date(q.date)
    const yearsDiff = t.getFullYear() - qd.getFullYear()
    if (yearsDiff < 0 || yearsDiff > 1) continue
    const alignedLastYear = new Date(qd.getFullYear() + 1, qd.getMonth(), qd.getDate())
    const daysDiff = Math.abs((t.getTime() - alignedLastYear.getTime()) / (1000 * 60 * 60 * 24))
    if (daysDiff < bestDiff) { bestDiff = daysDiff; best = q }
  }
  return bestDiff <= 60 ? best : null
}

// Market cap, SEC quarterly/annual history, and historical EPS surprise% don't meaningfully change
// within a trading day -- the only thing that actually changes intraday is whether a symbol's
// epsActual/revenueActual has posted yet, which comes from the (cheap, non-per-symbol) calendar
// calls above. The client sends back whatever enrichment it already has cached; anything still
// within this TTL is reused as-is instead of re-hitting Finnhub/SEC, so repeat auto-refreshes only
// pay the per-symbol cost once per day instead of on every refresh.
const CLIENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    const { fmpKey, finnhubKey, cachedEnrichment } = await req.json()
    const cache: Record<string, {
      marketCap?: number | null; industry?: string | null; sector?: string | null;
      pctFromWeek52High?: number | null; pctFromWeek52Low?: number | null;
      rsWeekPct?: number | null; rsMonthPct?: number | null;
      quarterlyHistory?: any[]; annualHistory?: any[]; cachedAt?: number
    }> = cachedEnrichment && typeof cachedEnrichment === 'object' ? cachedEnrichment : {}
    // US earnings calendars (and SEC filings) run on US Eastern Time, not UTC. Using
    // toISOString() here would make the server's "today" roll over 4-5 hours early every evening
    // (whenever it's already past midnight UTC but still before midnight ET) -- during that window
    // "today" silently meant "tomorrow", pushing the day's own earnings (including this morning's
    // BMO reporters) out of every date range. This is very likely what caused the earlier
    // "no earnings found today" reports throughout testing.
    const today = usEasternDateString(new Date())
    const nextWeek = usEasternDateString(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
    const weekAgo = usEasternDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))

    // Both providers cap how many rows a single request can return (Finnhub silently truncates at
    // 1500 for its whole-range call, and on a busy week that cap gets hit before reaching every day
    // in a 14-day span -- which was quietly dropping "today" entirely). Fetching today as its own
    // dedicated request guarantees it never gets crowded out by the wider past/future ranges.
    let fmpEarnings: any[] = []
    if (fmpKey) {
      const [past, todayFmp, future] = await Promise.all([
        fmpJson(`https://financialmodelingprep.com/stable/earnings-calendar?from=${weekAgo}&to=${today}&apikey=${fmpKey}`),
        fmpJson(`https://financialmodelingprep.com/stable/earnings-calendar?from=${today}&to=${today}&apikey=${fmpKey}`),
        fmpJson(`https://financialmodelingprep.com/stable/earnings-calendar?from=${today}&to=${nextWeek}&apikey=${fmpKey}`),
      ])
      fmpEarnings = [
        ...(Array.isArray(past) ? past : []),
        ...(Array.isArray(todayFmp) ? todayFmp : []),
        ...(Array.isArray(future) ? future : []),
      ]
    }

    const fhCalendar = async (from: string, to: string): Promise<any[]> => {
      try {
        const r = await fetchWithTimeout(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${finnhubKey}`)
        if (!r.ok) return []
        const d = await r.json()
        return Array.isArray(d.earningsCalendar) ? d.earningsCalendar : []
      } catch { return [] }
    }

    let fhEarnings: any[] = []
    if (finnhubKey) {
      const [past, todayFh, future] = await Promise.all([
        fhCalendar(weekAgo, today),
        fhCalendar(today, today),
        fhCalendar(today, nextWeek),
      ])
      fhEarnings = [...past, ...todayFh, ...future]
    }

    // FMP and Finnhub don't always update an "actual" at the same speed once a company reports --
    // previously this always preferred FMP's row whenever FMP listed the symbol at all, even if FMP's
    // own copy was still showing an estimate while Finnhub already had the real actual. Now both
    // sources are normalized and merged per symbol+date, picking whichever one actually has reported
    // data if only one of them does (falling back to FMP for the tie-break when both or neither do,
    // since FMP is otherwise the primary source here).
    const rowKey = (symbol: string, date: string) => `${symbol}_${date}`
    const fmpByKey = new Map<string, any>()
    fmpEarnings.forEach((e: any) => {
      fmpByKey.set(rowKey(e.symbol, e.date), {
        symbol: e.symbol, date: e.date, time: '',
        epsEstimated: e.epsEstimated, epsActual: e.epsActual,
        revenueEstimated: e.revenueEstimated, revenueActual: e.revenueActual,
      })
    })
    const fhByKey = new Map<string, any>()
    fhEarnings.forEach((e: any) => {
      fhByKey.set(rowKey(e.symbol, e.date), {
        symbol: e.symbol, date: e.date, time: e.hour || '',
        epsEstimated: e.epsEstimate, epsActual: e.epsActual,
        revenueEstimated: e.revenueEstimate, revenueActual: e.revenueActual,
      })
    })
    // Finnhub still reports pre/after-market timing (FMP's stable calendar dropped that field).
    const hourBySymbol = new Map<string, string>()
    fhEarnings.forEach((e: any) => {
      if (e.symbol && e.hour) hourBySymbol.set(e.symbol, e.hour)
    })

    const allKeys = new Set<string>()
    fmpByKey.forEach((_, k) => allKeys.add(k))
    fhByKey.forEach((_, k) => allKeys.add(k))
    let earnings: any[] = []
    allKeys.forEach((k) => {
      const fmpRow = fmpByKey.get(k)
      const fhRow = fhByKey.get(k)
      let row: any
      if (fmpRow && fhRow) {
        const fmpHasActual = fmpRow.epsActual != null || fmpRow.revenueActual != null
        const fhHasActual = fhRow.epsActual != null || fhRow.revenueActual != null
        row = (!fmpHasActual && fhHasActual) ? fhRow : fmpRow
      } else {
        row = fmpRow || fhRow
      }
      if (!row.time) row.time = hourBySymbol.get(row.symbol) || ''
      earnings.push(row)
    })

    // Dedup symbol+date (past/future ranges can overlap slightly at the boundary)
    const seenKeys = new Set<string>()
    earnings = earnings.filter(e => {
      const k = `${e.symbol}_${e.date}`
      if (seenKeys.has(k)) return false
      seenKeys.add(k); return true
    })

    // Drop rows with no data at all (no estimate, no actual -- neither FMP nor Finnhub has coverage).
    // These are typically delayed/unlisted/no-analyst-coverage tickers and just add noise.
    earnings = earnings.filter(e =>
      e.epsEstimated != null || e.epsActual != null || e.revenueEstimated != null || e.revenueActual != null
    )

    if (finnhubKey) {
      // Market cap still comes from Finnhub's `profile2` (SEC has no real-time price data). Quarterly
      // and annual EPS/Sales history (O'Neil/Bonde-style, YoY-only) now comes directly from SEC
      // EDGAR's XBRL companyfacts API instead of Finnhub's financials-reported -- SEC tags both
      // discrete and cumulative figures as separate facts, so no derive-by-subtraction is needed, it
      // goes back many more years, and it's off Finnhub's 60/min budget entirely (SEC's own limit is
      // a much more generous ~10 req/sec).
      const allTodaySymbols = Array.from(new Set(earnings.filter(e => e.date === today).map(e => e.symbol).filter(Boolean)))

      const isCacheFresh = (sym: string) => {
        const c = cache[sym]
        return c?.cachedAt != null && Date.now() - c.cachedAt < CLIENT_CACHE_TTL_MS && c.marketCap != null
      }

      // Trying to freshly enrich every one of a busy day's symbols in a single request is what kept
      // overwhelming Finnhub's rate limit -- even a "safe-looking" total call count could partially
      // fail because a large simultaneous batch seems to trigger rejections on its own, independent of
      // the per-minute total. Instead: serve every already-cached symbol for free (no calls at all),
      // and cap *fresh* enrichment to a small, genuinely safe number per request. A busy day's coverage
      // then completes gradually over a few auto-refresh cycles (each one enriches the next batch of
      // not-yet-cached symbols) instead of trying and failing to do it all at once -- and once a symbol
      // is cached, it stays complete for the rest of the day.
      const cachedSymbols = allTodaySymbols.filter(isCacheFresh)
      const freshSymbols = allTodaySymbols.filter(sym => !isCacheFresh(sym)).slice(0, MAX_ENRICH_LOOKUPS)
      const symbols = cachedSymbols.concat(freshSymbols)

      const capBySymbol = new Map<string, number>()
      const industryBySymbol = new Map<string, string>()
      const sectorBySymbol = new Map<string, string>()
      const pctFromHighBySymbol = new Map<string, number>()
      const pctFromLowBySymbol = new Map<string, number>()
      const rsWeekBySymbol = new Map<string, number>()
      const rsMonthBySymbol = new Map<string, number>()
      const quartersBySymbol = new Map<string, ReturnType<typeof withGrowth>>()
      const annualBySymbol = new Map<string, ReturnType<typeof annualWithYoy>>()
      // Finnhub's own stock/earnings sometimes has today's actual/estimate/surprise% before its
      // calendar/earnings does (they appear to update on different schedules) -- backfills the
      // calendar-sourced row below when the calendar itself hasn't caught up yet. Deliberately NOT
      // cached: whether a company has reported is exactly the one thing that legitimately changes
      // during the day, so it's worth rechecking on every fresh (uncached) enrichment pass rather than
      // freezing a "hasn't reported yet" null for the rest of the day once the symbol gets cached.
      const todaysFhReportBySymbol = new Map<string, { epsActual: number | null; epsEstimated: number | null }>()

      const cikMap = await getTickerCikMap()

      // Only the first MAX_RS_LOOKUPS *freshly-fetched* symbols get the 2 extra RS/52-week calls (see
      // the comment on MAX_ENRICH_LOOKUPS above for why). Everyone else still gets full core enrichment.
      const rsEligible = new Set(freshSymbols.slice(0, MAX_RS_LOOKUPS))

      // 1-week relative strength has no pre-computed Finnhub field (unlike the 1-month one below), so
      // it's derived by diffing the stock's own 5-day return against SPY's -- needs SPY's number once
      // per request, not per symbol. Skipped entirely if no RS-eligible symbol actually needs fetching.
      const spyMetrics = rsEligible.size > 0
        ? extractBasicMetrics(await fhJson(`https://finnhub.io/api/v1/stock/metric?symbol=SPY&metric=all&token=${finnhubKey}`))
        : null

      // Smaller batch + slightly longer delay than before -- lower peak concurrency per burst, since
      // that's what actually seemed to trigger partial failures, not just the per-minute total.
      const ENRICH_BATCH_SIZE = 6
      const ENRICH_BATCH_DELAY_MS = 1200
      for (let i = 0; i < symbols.length; i += ENRICH_BATCH_SIZE) {
        const batch = symbols.slice(i, i + ENRICH_BATCH_SIZE)
        await Promise.all(batch.map(async (sym) => {
          const cached = cache[sym]
          // Age alone isn't enough -- a cache entry written while Finnhub was rate-limited (or any
          // other transient failure) would otherwise get treated as "fresh" for a full day even
          // though marketCap/industry never actually landed. Requiring marketCap != null means a
          // partial/failed fetch self-heals on the very next request instead of being stuck until the
          // TTL expires.
          const cacheIsFresh = cached?.cachedAt != null && Date.now() - cached.cachedAt < CLIENT_CACHE_TTL_MS && cached.marketCap != null
          if (cacheIsFresh) {
            if (cached!.marketCap != null) capBySymbol.set(sym, cached!.marketCap as number)
            if (cached!.industry) industryBySymbol.set(sym, cached!.industry as string)
            if (cached!.sector) sectorBySymbol.set(sym, cached!.sector as string)
            if (cached!.pctFromWeek52High != null) pctFromHighBySymbol.set(sym, cached!.pctFromWeek52High as number)
            if (cached!.pctFromWeek52Low != null) pctFromLowBySymbol.set(sym, cached!.pctFromWeek52Low as number)
            if (cached!.rsWeekPct != null) rsWeekBySymbol.set(sym, cached!.rsWeekPct as number)
            if (cached!.rsMonthPct != null) rsMonthBySymbol.set(sym, cached!.rsMonthPct as number)
            if (cached!.quarterlyHistory) quartersBySymbol.set(sym, cached!.quarterlyHistory as any)
            if (cached!.annualHistory) annualBySymbol.set(sym, cached!.annualHistory as any)
            return // already have this for today -- skip Finnhub/SEC entirely
          }

          const cik = cikMap.get(sym.toUpperCase())
          const wantsRs = rsEligible.has(sym)
          const [fhProfile, facts, fhEarningsHistory, basicFinancials, quote, sector] = await Promise.all([
            fhJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${finnhubKey}`),
            fetchSecFactsForSymbol(sym, cik),
            fhJson(`https://finnhub.io/api/v1/stock/earnings?symbol=${sym}&token=${finnhubKey}`),
            wantsRs ? fhJson(`https://finnhub.io/api/v1/stock/metric?symbol=${sym}&metric=all&token=${finnhubKey}`) : Promise.resolve(null),
            wantsRs ? fhJson(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${finnhubKey}`) : Promise.resolve(null),
            cik ? fetchSecSector(cik) : Promise.resolve(null),
          ])

          if (fhProfile?.marketCapitalization != null) capBySymbol.set(sym, fhProfile.marketCapitalization * 1e6)
          if (fhProfile?.finnhubIndustry) industryBySymbol.set(sym, fhProfile.finnhubIndustry)
          if (sector) sectorBySymbol.set(sym, sector)

          if (Array.isArray(fhEarningsHistory)) {
            const todaysReport = fhEarningsHistory.find((r: any) => r?.period === today)
            if (todaysReport) {
              todaysFhReportBySymbol.set(sym, {
                epsActual: num(todaysReport.actual),
                epsEstimated: num(todaysReport.estimate),
              })
            }
          }

          if (wantsRs) {
            // "Latest price" here is Finnhub's quote `c` -- during market hours it's the live price,
            // but for most of when this dashboard actually gets checked (pre-market, after-hours,
            // weekends) it settles to the prior session's actual close, which is exactly what was
            // asked for: a once-a-day reference point, not a tick-by-tick feed.
            const { week52High, week52Low, fiveDayReturnPct, rsMonthPct } = extractBasicMetrics(basicFinancials)
            const latestPrice = num(quote?.c)
            if (latestPrice != null && week52High) pctFromHighBySymbol.set(sym, ((latestPrice - week52High) / week52High) * 100)
            if (latestPrice != null && week52Low) pctFromLowBySymbol.set(sym, ((latestPrice - week52Low) / week52Low) * 100)
            if (rsMonthPct != null) rsMonthBySymbol.set(sym, rsMonthPct)
            if (fiveDayReturnPct != null && spyMetrics?.fiveDayReturnPct != null) {
              rsWeekBySymbol.set(sym, fiveDayReturnPct - spyMetrics.fiveDayReturnPct)
            }
          }

          if (facts) {
            const quarters = attachEpsSurprise(
              withGrowth(buildQuartersFromFacts(facts)).slice(0, 8),
              Array.isArray(fhEarningsHistory) ? fhEarningsHistory : []
            )
            quartersBySymbol.set(sym, quarters)
            annualBySymbol.set(sym, annualWithYoy(buildAnnualFromFacts(facts)).slice(0, 6))
          }
        }))
        if (i + ENRICH_BATCH_SIZE < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, ENRICH_BATCH_DELAY_MS))
        }
      }

      earnings = earnings.map(e => {
        // Finnhub's stock/earnings sometimes has today's actual/estimate before its own calendar
        // endpoint does -- backfill from it so EPS Surprise % (computed client-side from these two
        // fields) doesn't sit blank just because the calendar specifically hasn't caught up yet.
        const fhTodayReport = todaysFhReportBySymbol.get(e.symbol)
        const epsActual = e.epsActual ?? fhTodayReport?.epsActual ?? null
        const epsEstimated = e.epsEstimated ?? fhTodayReport?.epsEstimated ?? null

        const quarters = quartersBySymbol.get(e.symbol) || []
        // The exact quarter being reported today usually isn't in `quarters` yet (the 10-Q/10-K lags
        // the earnings announcement by several weeks), so find whichever quarter sits closest to a
        // year before today's report date instead.
        const yoyMatch = findYoyMatch(e.date, quarters)
        const epsForGrowth = epsActual ?? epsEstimated
        const revenueForGrowth = e.revenueActual ?? e.revenueEstimated
        let epsGrowthPctYoy = yoyMatch ? growthPct(epsForGrowth, yoyMatch.eps) : null
        const revenueGrowthPctYoy = yoyMatch ? growthPct(revenueForGrowth, yoyMatch.revenue) : null
        // This row's EPS is the calendar's adjusted/non-GAAP "actual", diffed against a GAAP prior-
        // year figure -- usually close enough, but for companies where the two diverge a lot (large
        // M&A/impairment charges) it can produce an implausible swing. Suppress anything this extreme
        // on the headline row rather than show a misleading number; the quarterly table below is
        // GAAP-consistent throughout and isn't subject to this, so it's shown uncapped there.
        if (epsGrowthPctYoy != null && Math.abs(epsGrowthPctYoy) > 300) epsGrowthPctYoy = null
        return {
          ...e,
          epsActual,
          epsEstimated,
          marketCap: capBySymbol.get(e.symbol) ?? null,
          industry: industryBySymbol.get(e.symbol) ?? null,
          sector: sectorBySymbol.get(e.symbol) ?? null,
          pctFromWeek52High: pctFromHighBySymbol.get(e.symbol) ?? null,
          pctFromWeek52Low: pctFromLowBySymbol.get(e.symbol) ?? null,
          rsWeekPct: rsWeekBySymbol.get(e.symbol) ?? null,
          rsMonthPct: rsMonthBySymbol.get(e.symbol) ?? null,
          epsGrowthPctYoy,
          revenueGrowthPctYoy,
          quarterlyHistory: quarters,
          annualHistory: annualBySymbol.get(e.symbol) || [],
        }
      })
    }

    earnings.sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    // No row-count cap here anymore: sorting ascending then slicing was silently cutting off
    // today/future entries whenever the past-week volume alone exceeded the cap. The only genuinely
    // expensive part (per-symbol enrichment) is already scoped to today's reporters above, so
    // returning the full list costs nothing extra.
    return NextResponse.json({ earnings })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
