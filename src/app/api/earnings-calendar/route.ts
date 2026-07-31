import { NextRequest, NextResponse } from 'next/server'

// Enrichment (market cap, growth%, last-4-quarters) costs 2 FMP calls per symbol. Doing that for
// the whole past+next 7 day window (hundreds of tickers) burns an entire day's free-tier quota in
// one page load. Scoping it to just today's reporters keeps it to a few dozen calls -- comfortably
// under a typical 250/day cap -- while past/future rows still get the free base data (ticker, EPS,
// revenue, surprise %) straight from the calendar fetch.
const MAX_ENRICH_LOOKUPS = 200

async function fmpJson(url: string) {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

// Same shape, kept as a separate name so it's obvious which provider a call is hitting at a glance.
const fhJson = fmpJson

// Find the entry in a company's own earnings history ~1 year before the target date (same fiscal quarter last year)
function findYoyEntry(targetDate: string, hist: any[]) {
  const t = new Date(targetDate)
  let best: any = null, bestDiff = Infinity
  for (const h of hist) {
    if (!h.date || h.date === targetDate) continue
    const hd = new Date(h.date)
    if (t.getFullYear() - hd.getFullYear() !== 1) continue
    const alignedLastYear = new Date(hd.getFullYear() + 1, hd.getMonth(), hd.getDate())
    const daysDiff = Math.abs((t.getTime() - alignedLastYear.getTime()) / (1000 * 60 * 60 * 24))
    if (daysDiff < bestDiff) { bestDiff = daysDiff; best = h }
  }
  return bestDiff <= 45 ? best : null
}

// Find the immediately preceding reported quarter (for quarter-over-quarter growth)
function findQoqEntry(targetDate: string, hist: any[]) {
  const t = new Date(targetDate)
  let best: any = null, bestDiff = Infinity
  for (const h of hist) {
    if (!h.date || h.date === targetDate) continue
    const hd = new Date(h.date)
    if (hd >= t) continue
    const daysDiff = (t.getTime() - hd.getTime()) / (1000 * 60 * 60 * 24)
    if (daysDiff < bestDiff) { bestDiff = daysDiff; best = h }
  }
  return best
}

function growthPct(current: number | null | undefined, prior: number | null | undefined) {
  if (current == null || prior == null || prior === 0) return null
  return ((current - prior) / Math.abs(prior)) * 100
}

// Revenue isn't a single standardized XBRL tag -- it varies by industry (a REIT reports "net
// interest income", a bank "noninterest income", a normal company "net sales"/"revenues"). This
// tries the common tags in priority order and falls back through them; it won't be perfect for
// every company, but covers the vast majority for free.
const REVENUE_CONCEPTS = [
  'us-gaap_Revenues',
  'us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax',
  'us-gaap_RevenueFromContractWithCustomerIncludingAssessedTax',
  'us-gaap_SalesRevenueNet',
  'us-gaap_SalesRevenueGoodsNet',
  'us-gaap_SalesRevenueServicesNet',
  'us-gaap_InterestAndDividendIncomeOperating',
  'us-gaap_InterestIncomeExpenseNet',
  'us-gaap_NoninterestIncome',
  'us-gaap_TotalRevenuesAndOtherIncome',
]
function extractConcept(ic: any[], concepts: string[]): number | null {
  for (const concept of concepts) {
    const item = ic.find((x: any) => x.concept === concept)
    if (typeof item?.value === 'number') return item.value
  }
  return null
}

// Turn Finnhub's as-reported financials (`stock/financials-reported`) into {date, revenueActual}.
// This is the richest free revenue history available: dozens of quarters per company, vs. none at
// all from `stock/earnings` and 5 (when FMP isn't quota-exhausted) from FMP.
//
// EPS is deliberately NOT sourced from here: `financials-reported`'s EarningsPerShare concepts are
// raw GAAP EPS straight from the 10-Q/10-K, which for companies with heavy one-time items (M&A
// charges, impairments -- AbbVie is a good example) can differ wildly from the "actual" EPS that
// earnings calendars and analyst estimates use (usually adjusted/non-GAAP EPS). Diffing GAAP history
// against an adjusted current-quarter figure produced nonsense growth like +800% in testing. EPS
// history stays on `stock/earnings`, which reports the same adjusted metric as the calendar itself.
//
// A second wrinkle: Finnhub's quarterly reports only cover Q1 as a clean 3-month period. Q2 and Q3
// come back as year-to-date cumulative (e.g. "Q3" spans Jan 1 - Sep 30, 9 months, not just Jul-Sep),
// and Q4 isn't in this feed at all (it's folded into the annual 10-K). Using the cumulative figures
// as if they were single-quarter revenue produced numbers ~3x too high in testing. Rather than derive
// discrete quarters via subtraction (needs the annual report too, for Q4), this keeps only reports
// whose span is close to one quarter (~80-100 days) so what's shown is always correct, even though
// it means real gaps for Q2/Q3/Q4 until FMP -- or a proper derivation -- fills them in.
function revenueHistoryFromFinancialsReported(data: any): any[] {
  const reports = Array.isArray(data?.data) ? data.data : []
  return reports
    .map((r: any) => {
      const start = typeof r.startDate === 'string' ? new Date(r.startDate) : null
      const end = typeof r.endDate === 'string' ? new Date(r.endDate) : null
      if (!start || !end) return null
      const spanDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      if (spanDays < 80 || spanDays > 100) return null // cumulative (H1/9mo) report, not a discrete quarter
      const ic = r.report?.ic || []
      const revenueActual = extractConcept(ic, REVENUE_CONCEPTS)
      const date = r.endDate.split(' ')[0]
      if (revenueActual == null) return null
      return { date, revenueActual }
    })
    .filter(Boolean)
}

// The calendar's `date` is the report/filing date; history entries are keyed by fiscal period-end
// date, which is typically 20-60 days earlier. If a company just reported, its own quarter now
// shows up in `hist` dated close to (but before) the report date -- comparing against the report
// date directly would let YoY/QoQ pick that same quarter as its own "prior" period (a quarter
// diffed against itself yields exactly 0% growth, which is how this bug surfaced). Resolving to the
// history's own most-recent date first sidesteps that whenever it represents the just-reported quarter.
function resolveSelfDate(reportDate: string, hist: any[]): string {
  if (hist.length === 0) return reportDate
  const latest = [...hist].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
  if (!latest?.date) return reportDate
  const gapDays = (new Date(reportDate).getTime() - new Date(latest.date).getTime()) / (1000 * 60 * 60 * 24)
  return (gapDays >= 0 && gapDays <= 100) ? latest.date : reportDate
}

// Build the "last 4 reported quarters" panel from a company's own history, with YoY/QoQ growth
// computed per quarter against the rest of that same history list.
function buildLast4(hist: any[]) {
  const reported = hist.filter(h => h.epsActual != null || h.revenueActual != null)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 4)
  return reported.map(h => {
    const yoy = findYoyEntry(h.date, hist)
    const qoq = findQoqEntry(h.date, hist)
    return {
      date: h.date,
      epsActual: h.epsActual,
      revenueActual: h.revenueActual,
      epsGrowthPctYoy: yoy ? growthPct(h.epsActual, yoy.epsActual) : null,
      revenueGrowthPctYoy: yoy ? growthPct(h.revenueActual, yoy.revenueActual) : null,
      epsGrowthPctQoq: qoq ? growthPct(h.epsActual, qoq.epsActual) : null,
      revenueGrowthPctQoq: qoq ? growthPct(h.revenueActual, qoq.revenueActual) : null,
    }
  })
}

export async function POST(req: NextRequest) {
  try {
    const { fmpKey, finnhubKey } = await req.json()
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

    if (finnhubKey || fmpKey) {
      // Market cap comes from Finnhub `profile2`. EPS history (for growth% and the last-4-quarters
      // panel) comes from Finnhub `stock/earnings` -- only 4 quarters, but it's the *adjusted* EPS
      // metric, consistent with what the calendar itself reports as "actual". Revenue history comes
      // from `stock/financials-reported` (as-reported SEC filings, dozens of quarters) since revenue
      // doesn't have the same GAAP-vs-adjusted divergence problem that ruled out using it for EPS.
      // FMP's `earnings` is kept as a fallback layered underneath both.
      // Scoped to today's reporters only -- see MAX_ENRICH_LOOKUPS comment above.
      let symbols = Array.from(new Set(earnings.filter(e => e.date === today).map(e => e.symbol).filter(Boolean)))
      symbols = symbols.slice(0, MAX_ENRICH_LOOKUPS)

      const capBySymbol = new Map<string, number>()
      const historyBySymbol = new Map<string, any[]>()
      await Promise.all(symbols.map(async (sym) => {
        const [fhProfile, fhEps, fhFinancials, fmpHist] = await Promise.all([
          finnhubKey ? fhJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${finnhubKey}`) : Promise.resolve(null),
          finnhubKey ? fhJson(`https://finnhub.io/api/v1/stock/earnings?symbol=${sym}&token=${finnhubKey}`) : Promise.resolve(null),
          finnhubKey ? fhJson(`https://finnhub.io/api/v1/stock/financials-reported?symbol=${sym}&freq=quarterly&token=${finnhubKey}`) : Promise.resolve(null),
          // This plan's FMP earnings-history endpoint caps `limit` at 5 -- a higher value fails outright.
          fmpKey ? fmpJson(`https://financialmodelingprep.com/stable/earnings?symbol=${sym}&limit=5&apikey=${fmpKey}`) : Promise.resolve(null),
        ])

        if (fhProfile?.marketCapitalization != null) capBySymbol.set(sym, fhProfile.marketCapitalization * 1e6)

        const byDate = new Map<string, any>()
        if (Array.isArray(fhEps)) {
          fhEps.forEach((h: any) => { if (h.period) byDate.set(h.period, { date: h.period, epsActual: h.actual, revenueActual: null }) })
        }
        revenueHistoryFromFinancialsReported(fhFinancials).forEach((h: any) => {
          const existing = byDate.get(h.date)
          byDate.set(h.date, { date: h.date, epsActual: existing?.epsActual ?? null, revenueActual: h.revenueActual })
        })
        if (Array.isArray(fmpHist)) {
          fmpHist.forEach((h: any) => {
            if (!h.date) return
            const existing = byDate.get(h.date)
            byDate.set(h.date, {
              date: h.date,
              epsActual: existing?.epsActual ?? h.epsActual ?? null,
              revenueActual: existing?.revenueActual ?? h.revenueActual ?? null,
            })
          })
        }
        historyBySymbol.set(sym, Array.from(byDate.values()))
      }))

      earnings = earnings.map(e => {
        const hist = historyBySymbol.get(e.symbol) || []
        const selfDate = resolveSelfDate(e.date, hist)
        const yoy = findYoyEntry(selfDate, hist)
        const qoq = findQoqEntry(selfDate, hist)
        const epsForGrowth = e.epsActual ?? e.epsEstimated
        const revenueForGrowth = e.revenueActual ?? e.revenueEstimated
        return {
          ...e,
          marketCap: capBySymbol.get(e.symbol) ?? null,
          epsGrowthPctYoy: yoy ? growthPct(epsForGrowth, yoy.epsActual) : null,
          revenueGrowthPctYoy: yoy ? growthPct(revenueForGrowth, yoy.revenueActual) : null,
          epsGrowthPctQoq: qoq ? growthPct(epsForGrowth, qoq.epsActual) : null,
          revenueGrowthPctQoq: qoq ? growthPct(revenueForGrowth, qoq.revenueActual) : null,
          last4: buildLast4(hist),
        }
      })
    }

    earnings.sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    // No row-count cap here anymore: sorting ascending then slicing was silently cutting off
    // today/future entries whenever the past-week volume alone exceeded the cap. The only genuinely
    // expensive part (per-symbol FMP enrichment) is already scoped to today's reporters above, so
    // returning the full list costs nothing extra.
    return NextResponse.json({ earnings })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
