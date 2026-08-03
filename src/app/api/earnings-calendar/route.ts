import { NextRequest, NextResponse } from 'next/server'

// SEC calls (companyfacts payloads run 1-3MB each) take longer than the old all-Finnhub version.
// Default serverless timeout (10s) isn't enough headroom on a busy earnings day; this raises it.
export const maxDuration = 60

const SEC_AGENT = 'TradeAdvisor movaram@proton.me'

// Enrichment now costs 2 Finnhub calls (market cap, historical EPS surprise%) + 1 SEC call
// (EPS/Sales history) per symbol, batched to stay polite to both providers -- Finnhub's 60/min limit
// and SEC's ~10 req/sec fair-use guidance. Each batch adds ~1s of delay; at 60 symbols / batch size 10
// that's ~5s of added delay plus fetch time, well inside the 60s ceiling set above.
const MAX_ENRICH_LOOKUPS = 60

// Market cap and SEC quarterly/annual history don't meaningfully change within a week -- the client
// sends back whatever it already has cached, and anything still within this window is reused as-is
// instead of re-hitting Finnhub/SEC. Requiring marketCap != null (below, where this is checked) is
// what actually matters for correctness: a symbol whose enrichment failed or got rate-limited must
// NOT be treated as "done" just because an entry with a recent timestamp exists, or it would stay
// silently blank for the rest of the window instead of retrying on the next request.
const CLIENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function timeCategory(time: string): 'pre' | 'after' | 'other' {
  if (!time) return 'other'
  if (time === 'bmo' || time.toLowerCase().includes('before')) return 'pre'
  if (time === 'amc' || time.toLowerCase().includes('after')) return 'after'
  return 'other'
}

async function fhJson(url: string) {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

async function fmpJson(url: string) {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

function growthPct(current: number | null | undefined, prior: number | null | undefined) {
  if (current == null || prior == null || prior === 0) return null
  return ((current - prior) / Math.abs(prior)) * 100
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
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': SEC_AGENT } })
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
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { 'User-Agent': SEC_AGENT } })
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
    const r = await fetch(
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

export async function POST(req: NextRequest) {
  try {
    const { fmpKey, finnhubKey, cachedEnrichment, whenFilter } = await req.json()
    const cache: Record<string, { marketCap?: number | null; quarterlyHistory?: any[]; annualHistory?: any[]; cachedAt?: number }> =
      cachedEnrichment && typeof cachedEnrichment === 'object' ? cachedEnrichment : {}
    const wf: { pre: boolean; after: boolean } =
      whenFilter && typeof whenFilter === 'object' ? whenFilter : { pre: true, after: true }
    const today = new Date().toISOString().split('T')[0]
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

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
        const r = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${finnhubKey}`)
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

    // Finnhub still reports pre/after-market timing (FMP's stable calendar dropped that field), so merge it in by symbol.
    const hourBySymbol = new Map<string, string>()
    fhEarnings.forEach((e: any) => {
      if (e.symbol && e.hour) hourBySymbol.set(e.symbol, e.hour)
    })

    let earnings: any[]
    if (fmpEarnings.length > 0) {
      earnings = fmpEarnings.map((e: any) => ({
        symbol: e.symbol,
        date: e.date,
        time: hourBySymbol.get(e.symbol) || '',
        epsEstimated: e.epsEstimated,
        epsActual: e.epsActual,
        revenueEstimated: e.revenueEstimated,
        revenueActual: e.revenueActual,
      }))
      const coveredSymbols = new Set(fmpEarnings.map((e: any) => e.symbol))
      fhEarnings.forEach((e: any) => {
        if (!coveredSymbols.has(e.symbol)) {
          earnings.push({
            symbol: e.symbol, date: e.date, time: e.hour || '',
            epsEstimated: e.epsEstimate, epsActual: e.epsActual,
            revenueEstimated: e.revenueEstimate, revenueActual: e.revenueActual,
          })
        }
      })
    } else {
      earnings = fhEarnings.map((e: any) => ({
        symbol: e.symbol, date: e.date, time: e.hour || '',
        epsEstimated: e.epsEstimate, epsActual: e.epsActual,
        revenueEstimated: e.revenueEstimate, revenueActual: e.revenueActual,
      }))
    }

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
      // Only enrich symbols that will actually be visible under the current Pre-market/After-hours
      // selection -- if the user has narrowed to just one, there's no reason to spend API calls on
      // rows that are hidden anyway. Both checked (the default) means no narrowing at all.
      const todayRows = earnings.filter(e => e.date === today)
      const visibleTodayRows = (wf.pre && wf.after)
        ? todayRows
        : todayRows.filter(e => {
            const cat = timeCategory(e.time)
            return (cat === 'pre' && wf.pre) || (cat === 'after' && wf.after)
          })
      let symbols = Array.from(new Set(visibleTodayRows.map(e => e.symbol).filter(Boolean)))

      const isCacheFresh = (sym: string) => {
        const c = cache[sym]
        return c?.cachedAt != null && Date.now() - c.cachedAt < CLIENT_CACHE_TTL_MS && c.marketCap != null
      }
      // Not-yet-cached symbols go first so a slow/rate-limited day doesn't let the same already-cached
      // (free) symbols crowd out ones that still actually need a real fetch, within the fixed cap.
      symbols = symbols.filter(s => !isCacheFresh(s)).concat(symbols.filter(isCacheFresh)).slice(0, MAX_ENRICH_LOOKUPS)

      const capBySymbol = new Map<string, number>()
      const quartersBySymbol = new Map<string, ReturnType<typeof withGrowth>>()
      const annualBySymbol = new Map<string, ReturnType<typeof annualWithYoy>>()

      const cikMap = await getTickerCikMap()

      const ENRICH_BATCH_SIZE = 10
      const ENRICH_BATCH_DELAY_MS = 1000
      for (let i = 0; i < symbols.length; i += ENRICH_BATCH_SIZE) {
        const batch = symbols.slice(i, i + ENRICH_BATCH_SIZE)
        await Promise.all(batch.map(async (sym) => {
          const cached = cache[sym]
          if (isCacheFresh(sym)) {
            if (cached!.marketCap != null) capBySymbol.set(sym, cached!.marketCap as number)
            if (cached!.quarterlyHistory) quartersBySymbol.set(sym, cached!.quarterlyHistory as any)
            if (cached!.annualHistory) annualBySymbol.set(sym, cached!.annualHistory as any)
            return // already have this, still within the cache window -- skip Finnhub/SEC entirely
          }

          const cik = cikMap.get(sym.toUpperCase())
          const [fhProfile, facts, fhEarningsHistory] = await Promise.all([
            fhJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${finnhubKey}`),
            fetchSecFactsForSymbol(sym, cik),
            fhJson(`https://finnhub.io/api/v1/stock/earnings?symbol=${sym}&token=${finnhubKey}`),
          ])

          if (fhProfile?.marketCapitalization != null) capBySymbol.set(sym, fhProfile.marketCapitalization * 1e6)

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
        const quarters = quartersBySymbol.get(e.symbol) || []
        // The exact quarter being reported today usually isn't in `quarters` yet (the 10-Q/10-K lags
        // the earnings announcement by several weeks), so find whichever quarter sits closest to a
        // year before today's report date instead.
        const yoyMatch = findYoyMatch(e.date, quarters)
        const epsForGrowth = e.epsActual ?? e.epsEstimated
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
          marketCap: capBySymbol.get(e.symbol) ?? null,
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
