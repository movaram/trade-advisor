import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { fmpKey, finnhubKey } = await req.json()
    const today = new Date().toISOString().split('T')[0]
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    let earnings: any[] = []

    if (fmpKey) {
      const r = await fetch(`https://financialmodelingprep.com/api/v3/earning_calendar?from=${today}&to=${nextWeek}&apikey=${fmpKey}`)
      if (r.ok) {
        const data = await r.json()
        earnings = Array.isArray(data) ? data : []
      }
    }

    // Fallback to Finnhub if FMP returns nothing
    if (earnings.length === 0 && finnhubKey) {
      const r = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${nextWeek}&token=${finnhubKey}`)
      if (r.ok) {
        const data = await r.json()
        earnings = data.earningsCalendar || []
      }
    }

    return NextResponse.json({ earnings: earnings.slice(0, 200) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
