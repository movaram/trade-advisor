import { NextRequest, NextResponse } from 'next/server'

const MIN_MARKET_CAP = 30_000_000
// Safety cap so a heavy earnings-season week can't trigger an unbounded number of FMP calls
const MAX_ENRICH_LOOKUPS = 150

async function fmpJson(url: string) {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

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

function growthPct(current: number | null | undefined, prior: number | null | undefined) {
  if (current == null || prior == null || prior === 0) return null
  return ((current - prior) / Math.abs(prior)) * 100
}

export async function POST(req: NextRequest) {
  try {
    const { fmpKey, finnhubKey } = await req.json()
    const today = new Date().toISOString().split('T')[0]
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    let fmpEarnings: any[] = []
    if (fmpKey) {
      const [past, future] = await Promise.all([
        fmpJson(`https://financialmodelingprep.com/stable/earnings-calendar?from=${weekAgo}&to=${today}&apikey=${fmpKey}`),
        fmpJson(`https://financialmodelingprep.com/stable/earnings-calendar?from=${today}&to=${nextWeek}&apikey=${fmpKey}`),
      ])
      fmpEarnings = [...(Array.isArray(past) ? past : []), ...(Array.isArray(future) ? future : [])]
    }

    let fhEarnings: any[] = []
    if (finnhubKey) {
      try {
        const r = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${weekAgo}&to=${nextWeek}&token=${finnhubKey}`)
        if (r.ok) {
          const d = await r.json()
          fhEarnings = Array.isArray(d.earningsCalendar) ? d.earningsCalendar : []
        }
      } catch {}
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

    if (fmpKey) {
      // Market cap + US-exchange + YoY growth all come from two per-symbol FMP calls:
      // `profile` (marketCap + country in one shot) and `earnings` (own quarterly history, for YoY comparison).
      // A previously-tried `market-capitalization-batch` endpoint turned out to be unreliable on this
      // plan (silently rejects arbitrary symbols independent of batch size), so this fetches per symbol instead.
      let symbols = Array.from(new Set(earnings.map(e => e.symbol).filter(Boolean)))
      symbols = symbols.slice(0, MAX_ENRICH_LOOKUPS)

      const capBySymbol = new Map<string, number>()
      const countryBySymbol = new Map<string, string>()
      const historyBySymbol = new Map<string, any[]>()
      await Promise.all(symbols.map(async (sym) => {
        const [profileData, historyData] = await Promise.all([
          fmpJson(`https://financialmodelingprep.com/stable/profile?symbol=${sym}&apikey=${fmpKey}`),
          fmpJson(`https://financialmodelingprep.com/stable/earnings?symbol=${sym}&limit=6&apikey=${fmpKey}`),
        ])
        const p = Array.isArray(profileData) ? profileData[0] : profileData
        if (p?.marketCap != null) capBySymbol.set(sym, p.marketCap)
        if (p?.country) countryBySymbol.set(sym, p.country)
        if (Array.isArray(historyData)) historyBySymbol.set(sym, historyData)
      }))

      // Keep >= $30M and US-listed; keep unresolved lookups too (better to show a company than
      // wrongly hide one because a single FMP call failed or the symbol wasn't in scope of this pass)
      earnings = earnings.filter(e => {
        const cap = capBySymbol.get(e.symbol)
        const country = countryBySymbol.get(e.symbol)
        const capOk = cap == null || cap >= MIN_MARKET_CAP
        const countryOk = country == null || country === 'US'
        return capOk && countryOk
      })

      earnings = earnings.map(e => {
        const hist = historyBySymbol.get(e.symbol) || []
        const yoy = findYoyEntry(e.date, hist)
        const epsForGrowth = e.epsActual ?? e.epsEstimated
        const revenueForGrowth = e.revenueActual ?? e.revenueEstimated
        return {
          ...e,
          epsGrowthPct: yoy ? growthPct(epsForGrowth, yoy.epsActual) : null,
          revenueGrowthPct: yoy ? growthPct(revenueForGrowth, yoy.revenueActual) : null,
        }
      })
    }

    earnings.sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    return NextResponse.json({ earnings: earnings.slice(0, 300) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
