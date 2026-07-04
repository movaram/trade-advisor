import { NextRequest, NextResponse } from 'next/server'

async function getProfile(ticker: string, fk: string) {
  const r = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${fk}`)
  return r.json()
}

async function getMetrics(ticker: string, fk: string) {
  const r = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${fk}`)
  const d = await r.json()
  return d.metric || null
}

async function getNews(ticker: string, fk: string) {
  const to = new Date().toISOString().split('T')[0]
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${fk}`)
  const d = await r.json()
  return Array.isArray(d) ? d.slice(0, 8) : []
}

async function getSentiment(ticker: string, fk: string) {
  const r = await fetch(`https://finnhub.io/api/v1/news-sentiment?symbol=${ticker}&token=${fk}`)
  return r.json()
}

async function getInsiders(ticker: string, fk: string) {
  const r = await fetch(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${fk}`)
  const d = await r.json()
  return d.data?.slice(0, 8) || []
}

async function getRecommendations(ticker: string, fk: string) {
  const r = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${fk}`)
  const d = await r.json()
  return Array.isArray(d) ? d.slice(0, 2) : []
}

async function getSecFilings(ticker: string, types = ['8-K', '10-Q', '10-K', '4']) {
  const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const r = await fetch(
    `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=${types.join(',')}&dateRange=custom&startdt=${from}`,
    { headers: { 'User-Agent': 'TradeAdvisor movaram@proton.me' } }
  )
  const d = await r.json()
  return d.hits?.hits || []
}

export async function POST(req: NextRequest) {
  try {
    const { ticker, finnhub } = await req.json()
    if (!ticker || !finnhub) {
      return NextResponse.json({ error: 'Missing ticker or API key' }, { status: 400 })
    }

    const [profile, metrics, news, sentiment, insiders, filings, recs] = await Promise.all([
      getProfile(ticker, finnhub),
      getMetrics(ticker, finnhub),
      getNews(ticker, finnhub),
      getSentiment(ticker, finnhub),
      getInsiders(ticker, finnhub),
      getSecFilings(ticker),
      getRecommendations(ticker, finnhub)
    ])

    return NextResponse.json({ profile, metrics, news, sentiment, insiders, filings, recs })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
