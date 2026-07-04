import { NextRequest, NextResponse } from 'next/server'

const SEC_AGENT = 'TradeAdvisor movaram@proton.me'

async function fmp(path: string, key: string) {
  try {
    const r = await fetch(`https://financialmodelingprep.com/api/v3/${path}&apikey=${key}`)
    if (!r.ok) return null
    const d = await r.json()
    return Array.isArray(d) ? d : (d && typeof d === 'object' ? d : null)
  } catch { return null }
}

async function fh(path: string, key: string) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/${path}&token=${key}`)
    if (!r.ok) return null
    return r.json()
  } catch { return null }
}

export async function POST(req: NextRequest) {
  try {
    const { ticker, finnhubKey, fmpKey } = await req.json()
    if (!ticker || !finnhubKey) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

    const sym = ticker.toUpperCase()
    const to = new Date().toISOString().split('T')[0]
    const from30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const from90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // Finnhub calls
    const [profile, metrics, news, sentiment, insiders, recs, priceTarget, earnings] = await Promise.all([
      fh(`stock/profile2?symbol=${sym}`, finnhubKey),
      fh(`stock/metric?symbol=${sym}&metric=all`, finnhubKey),
      fh(`company-news?symbol=${sym}&from=${from30}&to=${to}`, finnhubKey),
      fh(`news-sentiment?symbol=${sym}`, finnhubKey),
      fh(`stock/insider-transactions?symbol=${sym}`, finnhubKey),
      fh(`stock/recommendation?symbol=${sym}`, finnhubKey),
      fh(`stock/price-target?symbol=${sym}`, finnhubKey),
      fh(`stock/earnings?symbol=${sym}&limit=8`, finnhubKey),
    ])

    // SEC filings
    const secData = await fetch(
      `https://efts.sec.gov/LATEST/search-index?q=%22${sym}%22&forms=8-K,10-Q,10-K,4&dateRange=custom&startdt=${from90}`,
      { headers: { 'User-Agent': SEC_AGENT } }
    ).then(r => r.json()).catch(() => ({ hits: { hits: [] } }))

    // FMP calls
    let earningsSurprise: any[] = [], institutionalOwnership: any[] = [],
        stockGrade: any[] = [], companyProfile: any = null, priceHistory: any[] = [],
        sectorPerf: any = null

    if (fmpKey) {
      const [surp, inst, grade, prof, hist, quote] = await Promise.allSettled([
        fmp(`earnings-surprises/${sym}?`, fmpKey),
        fmp(`institutional-holder/${sym}?`, fmpKey),
        fmp(`grade/${sym}?limit=30`, fmpKey),
        fmp(`profile/${sym}?`, fmpKey),
        fmp(`historical-price-full/${sym}?serietype=line&timeseries=365`, fmpKey),
        fmp(`quote/${sym}?`, fmpKey),
      ])

      earningsSurprise = surp.status === 'fulfilled' && Array.isArray(surp.value) ? surp.value.slice(0,8) : []
      institutionalOwnership = inst.status === 'fulfilled' && Array.isArray(inst.value) ? inst.value.slice(0,8) : []
      stockGrade = grade.status === 'fulfilled' && Array.isArray(grade.value) ? grade.value : []
      
      const profArr = prof.status === 'fulfilled' ? prof.value : null
      companyProfile = Array.isArray(profArr) ? profArr[0] : profArr

      const histData = hist.status === 'fulfilled' ? hist.value : null
      priceHistory = histData?.historical || []

      // Get current price from quote if not in profile
      const quoteData = quote.status === 'fulfilled' ? quote.value : null
      const quoteArr = Array.isArray(quoteData) ? quoteData[0] : quoteData
      if (quoteArr?.price && companyProfile) companyProfile.price = quoteArr.price
    }

    // Calculate price metrics
    const currentPrice = companyProfile?.price || null
    const w52High = metrics?.metric?.['52WeekHigh'] || (priceHistory.length > 0 ? Math.max(...priceHistory.map((d:any)=>d.close)) : null)
    const w52Low = metrics?.metric?.['52WeekLow'] || (priceHistory.length > 0 ? Math.min(...priceHistory.map((d:any)=>d.close)) : null)
    
    let high52Pct = null, low52Pct = null
    if (currentPrice && w52High) high52Pct = ((currentPrice - w52High) / w52High * 100).toFixed(1)
    if (currentPrice && w52Low) low52Pct = ((currentPrice - w52Low) / w52Low * 100).toFixed(1)

    // Calculate RS from price history
    let rs1m = null, rs3m = null, rsYtd = null
    if (priceHistory.length > 0 && currentPrice) {
      const getReturn = (daysAgo: number) => {
        const idx = Math.min(daysAgo, priceHistory.length - 1)
        const oldPrice = priceHistory[idx]?.close
        if (oldPrice) return ((currentPrice - oldPrice) / oldPrice * 100)
        return null
      }
      rs1m = getReturn(21)
      rs3m = getReturn(63)
      // YTD
      const startOfYear = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0]
      const ytdEntry = priceHistory.find((d:any) => d.date <= startOfYear)
      if (ytdEntry) rsYtd = ((currentPrice - ytdEntry.close) / ytdEntry.close * 100)
    }

    // Fallback RS from Finnhub metrics
    if (!rs1m) rs1m = metrics?.metric?.['1MonthPriceReturnDaily']
    if (!rs3m) rs3m = metrics?.metric?.['3MonthPriceReturnDaily']
    if (!rsYtd) rsYtd = metrics?.metric?.['yearToDatePriceReturn']

    // Recent analyst grade changes (30 days)
    const recentGrades = stockGrade.filter((g:any) => {
      if (!g.date) return false
      return new Date(g.date) > new Date(Date.now() - 30*24*60*60*1000)
    }).slice(0, 15)

    return NextResponse.json({
      profile: profile || {},
      metrics: metrics?.metric || {},
      news: Array.isArray(news) ? news.slice(0,15) : [],
      sentiment: sentiment || {},
      insiders: insiders?.data || [],
      recs: Array.isArray(recs) ? recs.slice(0,3) : [],
      priceTarget: priceTarget || {},
      earnings: Array.isArray(earnings) ? earnings : [],
      filings: secData?.hits?.hits || [],
      earningsSurprise,
      institutionalOwnership,
      recentGrades,
      companyProfile,
      priceRange: { week52High: w52High, week52Low: w52Low, currentPrice, high52Pct, low52Pct, athPct: high52Pct },
      rs: { month1: rs1m, month3: rs3m, ytd: rsYtd },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
