import { NextRequest, NextResponse } from 'next/server'

// Enrichment costs 3 Finnhub calls per symbol, batched (see ENRICH_BATCH_SIZE below) to stay under
// Finnhub's 60/min limit. Each batch adds ~1s of delay, so this also bounds total page-load time --
// at 60 symbols that's ~4 batches / ~3-4s of added delay, safely inside a serverless function's
// timeout; much higher and a very busy reporting day could push the request past it.
const MAX_ENRICH_LOOKUPS = 60

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
const EPS_CONCEPTS = ['us-gaap_EarningsPerShareDiluted', 'us-gaap_EarningsPerShareBasic']

function extractConcept(ic: any[], concepts: string[]): number | null {
  for (const concept of concepts) {
    const item = ic.find((x: any) => x.concept === concept)
    if (typeof item?.value === 'number') return item.value
  }
  return null
}

function sub(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : a - b
}

// William O'Neil (CANSLIM) / Pradeep Bonde (Stockbee)-style quarterly table: each quarter's EPS and
// Sales compared to the *same calendar quarter one year earlier* (never sequential quarter-to-quarter,
// since most businesses are seasonal and QoQ comparisons are noisy). Building this needs single-
// quarter (not cumulative) EPS/revenue going back 2+ years, which Finnhub doesn't hand over directly:
//
//   - `stock/financials-reported freq=quarterly` gives Q1 as a clean 3-month figure, but Q2 comes back
//     as Jan-Jun (6mo cumulative) and Q3 as Jan-Sep (9mo cumulative) -- not the discrete quarter.
//   - `freq=annual` gives the full fiscal year (10-K).
//
// Discrete quarters are recovered by subtraction: Q2 = H1 - Q1, Q3 = 9mo - H1, Q4 = FY - 9mo. This
// also keeps EPS and revenue on the *same* GAAP basis throughout, avoiding a bug from an earlier
// version of this route: mixing GAAP EPS (from financials-reported) with adjusted/non-GAAP "actual"
// EPS (from the earnings calendar) produced nonsense growth like +800% for companies where the two
// diverge a lot (AbbVie, due to large acquisition-related charges, was the case that surfaced it).
function deriveDiscreteQuarters(quarterlyReports: any[], annualReports: any[]) {
  const qByKey = new Map<string, { eps: number | null; revenue: number | null; endDate: string | null }>()
  quarterlyReports.forEach((r: any) => {
    const ic = r.report?.ic || []
    qByKey.set(`${r.year}-Q${r.quarter}`, {
      eps: extractConcept(ic, EPS_CONCEPTS),
      revenue: extractConcept(ic, REVENUE_CONCEPTS),
      endDate: typeof r.endDate === 'string' ? r.endDate.split(' ')[0] : null,
    })
  })
  const annualByYear = new Map<number, { eps: number | null; revenue: number | null; endDate: string | null }>()
  annualReports.forEach((r: any) => {
    const ic = r.report?.ic || []
    annualByYear.set(r.year, {
      eps: extractConcept(ic, EPS_CONCEPTS),
      revenue: extractConcept(ic, REVENUE_CONCEPTS),
      endDate: typeof r.endDate === 'string' ? r.endDate.split(' ')[0] : null,
    })
  })

  const years = new Set(quarterlyReports.map((r: any) => r.year))
  const discrete: { year: number; quarter: number; date: string | null; eps: number | null; revenue: number | null }[] = []
  years.forEach(year => {
    const q1 = qByKey.get(`${year}-Q1`)
    const h1 = qByKey.get(`${year}-Q2`) // cumulative Jan-Jun
    const m9 = qByKey.get(`${year}-Q3`) // cumulative Jan-Sep
    const fy = annualByYear.get(year)

    if (q1) discrete.push({ year, quarter: 1, date: q1.endDate, eps: q1.eps, revenue: q1.revenue })
    if (h1 && q1) discrete.push({ year, quarter: 2, date: h1.endDate, eps: sub(h1.eps, q1.eps), revenue: sub(h1.revenue, q1.revenue) })
    if (m9 && h1) discrete.push({ year, quarter: 3, date: m9.endDate, eps: sub(m9.eps, h1.eps), revenue: sub(m9.revenue, h1.revenue) })
    if (fy && m9) discrete.push({ year, quarter: 4, date: fy.endDate, eps: sub(fy.eps, m9.eps), revenue: sub(fy.revenue, m9.revenue) })
  })

  discrete.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  return discrete
}

// Attach YoY %Chg to each quarter by finding the same quarter number exactly one year earlier.
function withYoy(discrete: ReturnType<typeof deriveDiscreteQuarters>) {
  return discrete.map(q => {
    const prior = discrete.find(x => x.year === q.year - 1 && x.quarter === q.quarter)
    return {
      date: q.date,
      year: q.year,
      quarter: q.quarter,
      eps: q.eps,
      revenue: q.revenue,
      epsYoyPct: prior ? growthPct(q.eps, prior.eps) : null,
      revenueYoyPct: prior ? growthPct(q.revenue, prior.revenue) : null,
    }
  })
}

function annualHistoryFromReports(annualReports: any[]) {
  const years = annualReports
    .map((r: any) => ({
      year: r.year,
      date: typeof r.endDate === 'string' ? r.endDate.split(' ')[0] : null,
      eps: extractConcept(r.report?.ic || [], EPS_CONCEPTS),
      revenue: extractConcept(r.report?.ic || [], REVENUE_CONCEPTS),
    }))
    .sort((a, b) => b.year - a.year)
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

// Find the quarter in `quarters` closest to one year before `reportDate`, used to compute the main
// row's own growth% even before that exact quarter has been formally filed (financials-reported
// lags the earnings announcement by several weeks). This can occasionally compare the earnings
// calendar's adjusted "actual" EPS against a GAAP prior-year figure -- usually a close enough
// approximation, but can be noisy for companies with large one-time GAAP charges (see the EPS
// disclaimer shown next to the quarterly table).
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

    if (finnhubKey) {
      // Market cap from `profile2`. Quarterly EPS/Sales history (O'Neil/Bonde-style, YoY-only) is
      // derived from `stock/financials-reported` at both quarterly and annual frequency -- see
      // deriveDiscreteQuarters() above for why both calls are needed and how discrete quarters are
      // recovered. Scoped to today's reporters only -- see MAX_ENRICH_LOOKUPS comment above.
      let symbols = Array.from(new Set(earnings.filter(e => e.date === today).map(e => e.symbol).filter(Boolean)))
      symbols = symbols.slice(0, MAX_ENRICH_LOOKUPS)

      const capBySymbol = new Map<string, number>()
      const quartersBySymbol = new Map<string, ReturnType<typeof withYoy>>()
      const annualBySymbol = new Map<string, ReturnType<typeof annualHistoryFromReports>>()

      // 3 Finnhub calls per symbol, fired as one giant Promise.all, reliably triggered 429s on any
      // day with more than ~20 reporters (429s came back as ordinary failed fetches, which the
      // graceful-null handling in fhJson silently swallowed -- every row's enrichment went blank at
      // once, not just the "overflow" ones). Batching keeps each burst small enough to actually
      // succeed; it trades some page-load time for enrichment that reliably comes back non-empty.
      const ENRICH_BATCH_SIZE = 15
      const ENRICH_BATCH_DELAY_MS = 1000
      for (let i = 0; i < symbols.length; i += ENRICH_BATCH_SIZE) {
        const batch = symbols.slice(i, i + ENRICH_BATCH_SIZE)
        await Promise.all(batch.map(async (sym) => {
          const [fhProfile, quarterlyData, annualData] = await Promise.all([
            fhJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${finnhubKey}`),
            fhJson(`https://finnhub.io/api/v1/stock/financials-reported?symbol=${sym}&freq=quarterly&token=${finnhubKey}`),
            fhJson(`https://finnhub.io/api/v1/stock/financials-reported?symbol=${sym}&freq=annual&token=${finnhubKey}`),
          ])

          if (fhProfile?.marketCapitalization != null) capBySymbol.set(sym, fhProfile.marketCapitalization * 1e6)

          const quarterlyReports = Array.isArray(quarterlyData?.data) ? quarterlyData.data : []
          const annualReports = Array.isArray(annualData?.data) ? annualData.data : []
          const discrete = withYoy(deriveDiscreteQuarters(quarterlyReports, annualReports)).slice(0, 8)
          quartersBySymbol.set(sym, discrete)
          annualBySymbol.set(sym, annualHistoryFromReports(annualReports).slice(0, 6))
        }))
        if (i + ENRICH_BATCH_SIZE < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, ENRICH_BATCH_DELAY_MS))
        }
      }

      earnings = earnings.map(e => {
        const quarters = quartersBySymbol.get(e.symbol) || []
        // The exact quarter being reported today usually isn't in `quarters` yet (financials-reported
        // lags the earnings announcement by several weeks until the 10-Q/10-K is formally filed), so
        // find whichever derived quarter sits closest to a year before today's report date instead.
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
