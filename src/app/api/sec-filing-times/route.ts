import { NextRequest, NextResponse } from 'next/server'

const TTL = 10 * 60 * 1000
const cache = new Map<string, { data: any[]; ts: number }>()

async function fetchTimes(ticker: string, key: string) {
  const cached = cache.get(ticker)
  if (cached && Date.now() - cached.ts < TTL) return cached.data
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/filings?symbol=${encodeURIComponent(ticker)}&token=${key}`)
    if (!r.ok) return []
    const data = await r.json()
    const result = Array.isArray(data) ? data : []
    cache.set(ticker, { data: result, ts: Date.now() })
    return result
  } catch { return [] }
}

export async function POST(req: NextRequest) {
  try {
    const { tickers, finnhubKey } = await req.json()
    if (!finnhubKey || !Array.isArray(tickers) || tickers.length === 0) return NextResponse.json({ times: {} })

    // Hard safety cap so a runaway client request can't blow through the Finnhub free-tier rate limit
    const uniqueTickers = Array.from(new Set(tickers.filter((t: any) => t && t !== '—'))).slice(0, 30) as string[]
    const results = await Promise.all(uniqueTickers.map(t => fetchTimes(t, finnhubKey)))

    const times: Record<string, any[]> = {}
    uniqueTickers.forEach((t, i) => { times[t] = results[i] })

    return NextResponse.json({ times })
  } catch (e: any) {
    return NextResponse.json({ error: e.message, times: {} }, { status: 500 })
  }
}
