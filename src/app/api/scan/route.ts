import { NextRequest, NextResponse } from 'next/server'

async function getProfile(ticker: string, fk: string) {
  const r = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${fk}`)
  return r.json()
}

async function getNews(ticker: string, fk: string) {
  const to = new Date().toISOString().split('T')[0]
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${fk}`)
  const d = await r.json()
  return Array.isArray(d) ? d : []
}

async function getSentiment(ticker: string, fk: string) {
  const r = await fetch(`https://finnhub.io/api/v1/news-sentiment?symbol=${ticker}&token=${fk}`)
  return r.json()
}

async function getInsiders(ticker: string, fk: string) {
  const r = await fetch(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&token=${fk}`)
  const d = await r.json()
  return d.data || []
}

async function getRecommendations(ticker: string, fk: string) {
  const r = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${fk}`)
  const d = await r.json()
  return Array.isArray(d) ? d.slice(0, 2) : []
}

async function getSecFilings(ticker: string) {
  const from = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const r = await fetch(
    `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=8-K,4&dateRange=custom&startdt=${from}`,
    { headers: { 'User-Agent': 'TradeAdvisor movaram@proton.me' } }
  )
  const d = await r.json()
  return d.hits?.hits || []
}

export async function POST(req: NextRequest) {
  try {
    const { ticker, finnhub } = await req.json()
    if (!ticker || !finnhub) {
      return NextResponse.json({ error: 'Missing params' }, { status: 400 })
    }

    const [profile, sentiment, insiders, filings, recs, news] = await Promise.all([
      getProfile(ticker, finnhub),
      getSentiment(ticker, finnhub),
      getInsiders(ticker, finnhub),
      getSecFilings(ticker),
      getRecommendations(ticker, finnhub),
      getNews(ticker, finnhub)
    ])

    return NextResponse.json({ profile, sentiment, insiders, filings, recs, news })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
