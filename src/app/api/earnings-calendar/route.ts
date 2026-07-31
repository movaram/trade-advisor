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
      // Market cap and EPS history/growth come from Finnhub (`profile2` + `stock/earnings`) --
      // reliable and free, but Finnhub only returns 4 quarters of EPS history (no revenue at all),
      // which covers QoQ growth and the last-4-quarters panel but isn't quite enough history for
      // YoY. FMP's `earnings` endpoint (when its quota isn't exhausted) adds a 5th quarter back plus
      // revenue, so it's kept as a supplementary source layered on top rather than the primary one.
      // Scoped to today's reporters only -- see MAX_ENRICH_LOOKUPS comment above.
      let symbols = Array.from(new Set(earnings.filter(e => e.date === today).map(e => e.symbol).filter(Boolean)))
      symbols = symbols.slice(0, MAX_ENRICH_LOOKUPS)

      const capBySymbol = new Map<string, number>()
      const historyBySymbol = new Map<string, any[]>()
      await Promise.all(symbols.map(async (sym) => {
        const [fhProfile, fhHist, fmpHist] = await Promise.all([
          finnhubKey ? fhJson(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${finnhubKey}`) : Promise.resolve(null),
          finnhubKey ? fhJson(`https://finnhub.io/api/v1/stock/earnings?symbol=${sym}&token=${finnhubKey}`) : Promise.resolve(null),
          // This plan's FMP earnings-history endpoint caps `limit` at 5 -- a higher value fails outright.
          fmpKey ? fmpJson(`https://financialmodelingprep.com/stable/earnings?symbol=${sym}&limit=5&apikey=${fmpKey}`) : Promise.resolve(null),
        ])

        if (fhProfile?.marketCapitalization != null) capBySymbol.set(sym, fhProfile.marketCapitalization * 1e6)

        const byDate = new Map<string, any>()
        if (Array.isArray(fhHist)) {
          fhHist.forEach((h: any) => { if (h.period) byDate.set(h.period, { date: h.period, epsActual: h.actual, revenueActual: null }) })
        }
        if (Array.isArray(fmpHist)) {
          fmpHist.forEach((h: any) => {
            if (!h.date) return
            const existing = byDate.get(h.date)
            byDate.set(h.date, {
              date: h.date,
              epsActual: h.epsActual ?? existing?.epsActual ?? null,
              revenueActual: h.revenueActual ?? existing?.revenueActual ?? null,
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
