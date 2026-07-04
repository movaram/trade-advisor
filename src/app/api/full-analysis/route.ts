import { NextRequest, NextResponse } from 'next/server'

const SEC_AGENT = 'TradeAdvisor movaram@proton.me'

async function fmp(path: string, key: string) {
  try {
    const sep = path.includes('?') ? '&' : '?'
    const r = await fetch(`https://financialmodelingprep.com/stable/${path}${sep}apikey=${key}`)
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
        stockGrade: any[] = [], companyProfile: any = null,
        gradesConsensus: any = null, priceTargetConsensus: any = null,
        priceTargetSummary: any = null, gradesHistorical: any[] = []

    let quoteYearHigh: number | null = null, quoteYearLow: number | null = null

    if (fmpKey) {
      // Most recently completed calendar quarter, for institutional ownership lookups
      const now = new Date()
      const qNow = Math.floor(now.getMonth() / 3) + 1
      const instQuarter = qNow === 1 ? 4 : qNow - 1
      const instYear = qNow === 1 ? now.getFullYear() - 1 : now.getFullYear()

      const [surp, inst, grade, prof, quote, gConsensus, ptConsensus, ptSummary, gHistorical] = await Promise.allSettled([
        fmp(`earnings?symbol=${sym}&limit=5`, fmpKey),
        fmp(`institutional-ownership/extract?symbol=${sym}&year=${instYear}&quarter=${instQuarter}`, fmpKey),
        fmp(`grades?symbol=${sym}&limit=30`, fmpKey),
        fmp(`profile?symbol=${sym}`, fmpKey),
        fmp(`quote?symbol=${sym}`, fmpKey),
        fmp(`grades-consensus?symbol=${sym}`, fmpKey),
        fmp(`price-target-consensus?symbol=${sym}`, fmpKey),
        fmp(`price-target-summary?symbol=${sym}`, fmpKey),
        fmp(`grades-historical?symbol=${sym}&limit=6`, fmpKey),
      ])

      const earningsRaw = surp.status === 'fulfilled' && Array.isArray(surp.value) ? surp.value : []
      earningsSurprise = earningsRaw
        .filter((e: any) => e.epsActual != null)
        .map((e: any) => ({ date: e.date, actual: e.epsActual, estimate: e.epsEstimated, revenueActual: e.revenueActual, revenueEstimated: e.revenueEstimated }))
        .slice(0, 8)
      institutionalOwnership = inst.status === 'fulfilled' && Array.isArray(inst.value) ? inst.value.slice(0,8) : []
      stockGrade = grade.status === 'fulfilled' && Array.isArray(grade.value) ? grade.value : []

      const profArr = prof.status === 'fulfilled' ? prof.value : null
      companyProfile = Array.isArray(profArr) ? profArr[0] : profArr

      // Get current price / 52-week range from quote (more reliable than profile)
      const quoteData = quote.status === 'fulfilled' ? quote.value : null
      const quoteArr = Array.isArray(quoteData) ? quoteData[0] : quoteData
      if (quoteArr?.price && companyProfile) companyProfile.price = quoteArr.price
      if (quoteArr?.yearHigh) quoteYearHigh = quoteArr.yearHigh
      if (quoteArr?.yearLow) quoteYearLow = quoteArr.yearLow

      const gConsensusData = gConsensus.status === 'fulfilled' ? gConsensus.value : null
      gradesConsensus = Array.isArray(gConsensusData) ? gConsensusData[0] : gConsensusData

      const ptConsensusData = ptConsensus.status === 'fulfilled' ? ptConsensus.value : null
      priceTargetConsensus = Array.isArray(ptConsensusData) ? ptConsensusData[0] : ptConsensusData

      const ptSummaryData = ptSummary.status === 'fulfilled' ? ptSummary.value : null
      priceTargetSummary = Array.isArray(ptSummaryData) ? ptSummaryData[0] : ptSummaryData

      gradesHistorical = gHistorical.status === 'fulfilled' && Array.isArray(gHistorical.value) ? gHistorical.value.slice(0,6) : []
    }

    // Calculate price metrics (52-week range comes straight from FMP's quote, with a Finnhub fallback)
    const currentPrice = companyProfile?.price || null
    const w52High = quoteYearHigh || metrics?.metric?.['52WeekHigh'] || null
    const w52Low = quoteYearLow || metrics?.metric?.['52WeekLow'] || null

    let high52Pct = null, low52Pct = null
    if (currentPrice && w52High) high52Pct = ((currentPrice - w52High) / w52High * 100).toFixed(1)
    if (currentPrice && w52Low) low52Pct = ((currentPrice - w52Low) / w52Low * 100).toFixed(1)

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
      gradesConsensus,
      priceTargetConsensus,
      priceTargetSummary,
      gradesHistorical,
      priceRange: { week52High: w52High, week52Low: w52Low, currentPrice, high52Pct, low52Pct, athPct: high52Pct },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
