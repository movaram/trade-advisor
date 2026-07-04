import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { ticker, types } = await req.json()
    const forms = types || ['8-K', '10-Q', '10-K', '4', 'S-1']
    const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const r = await fetch(
      `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=${forms.join(',')}&dateRange=custom&startdt=${from}`,
      { headers: { 'User-Agent': 'TradeAdvisor movaram@proton.me' } }
    )
    const d = await r.json()
    return NextResponse.json({ filings: d.hits?.hits || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
