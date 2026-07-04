import { NextRequest, NextResponse } from 'next/server'

async function fmpFetch(url: string) {
  try {
    const r = await fetch(url)
    if (!r.ok) return { data: [] as any[], restricted: r.status === 402 }
    const d = await r.json()
    return { data: Array.isArray(d) ? d : [], restricted: false }
  } catch { return { data: [] as any[], restricted: false } }
}

export async function POST(req: NextRequest) {
  try {
    const { ticker, fmpKey } = await req.json()
    if (!fmpKey) return NextResponse.json({ quarterlyIncome: [], annualIncome: [], quarterlyEstimates: [], annualEstimates: [] })

    const [incomeQ, incomeA, estQ, estA] = await Promise.all([
      fmpFetch(`https://financialmodelingprep.com/stable/income-statement?symbol=${ticker}&period=quarter&limit=5&apikey=${fmpKey}`),
      fmpFetch(`https://financialmodelingprep.com/stable/income-statement?symbol=${ticker}&limit=5&apikey=${fmpKey}`),
      fmpFetch(`https://financialmodelingprep.com/stable/analyst-estimates?symbol=${ticker}&period=quarter&limit=5&apikey=${fmpKey}`),
      fmpFetch(`https://financialmodelingprep.com/stable/analyst-estimates?symbol=${ticker}&period=annual&limit=3&apikey=${fmpKey}`),
    ])

    // Estimates are sorted furthest-future-first; keep only future periods (not yet reported), nearest first
    const today = new Date().toISOString().split('T')[0]
    const upcoming = (arr: any[]) => arr.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json({
      quarterlyIncome: incomeQ.data,
      annualIncome: incomeA.data,
      quarterlyEstimates: upcoming(estQ.data).slice(0, 3),
      annualEstimates: upcoming(estA.data).slice(0, 3),
      quarterlyEstimatesRestricted: estQ.restricted,
      annualEstimatesRestricted: estA.restricted,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
