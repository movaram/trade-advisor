import { NextRequest, NextResponse } from 'next/server'

const SEC_AGENT = 'TradeAdvisor movaram@proton.me'

// Use EDGAR company search API which returns structured data with tickers
async function fetchFormType(formType: string, from: string) {
  try {
    // Use the search API with explicit form filter
    const url = `https://efts.sec.gov/LATEST/search-index?forms=${encodeURIComponent(formType)}&dateRange=custom&startdt=${from}&hits.hits._source.form_type=true&hits.hits._source.tickers=true`
    const r = await fetch(url, {
      headers: { 'User-Agent': SEC_AGENT, 'Accept': 'application/json' }
    })
    if (!r.ok) return []
    const data = await r.json()
    const hits = data.hits?.hits || []
    return hits.map((h: any) => {
      const s = h._source || {}
      const displayNames = Array.isArray(s.display_names) ? s.display_names : (s.display_names ? [s.display_names] : [])
      const rawName = displayNames[0] || s.entity_name || '—'
      
      // Extract ticker from (TICKER) pattern
      const tickerMatch = String(rawName).match(/\(([A-Z0-9\-\.]{1,6})\)\s*$/)
      const tickersArr = Array.isArray(s.tickers) ? s.tickers : []
      const ticker = tickersArr.length > 0 ? tickersArr[0].toUpperCase() : (tickerMatch ? tickerMatch[1] : '—')
      
      const company = String(rawName).replace(/\s*\([A-Z0-9\-\.]{1,6}\)\s*$/g, '').replace(/\s*\(CIK\s*[\d]+\)/gi, '').trim()
      const fileDate = (s.file_date || '').split('T')[0]

      let filedTimeET = '—', filedTimeAM = '—'
      if (fileDate) {
        const d = new Date(fileDate + 'T09:30:00-05:00')
        if (!isNaN(d.getTime())) {
          filedTimeET = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }) + ' ET'
          filedTimeAM = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Yerevan' }) + ' AM'
        }
      }

      return {
        id: h._id || `${ticker}-${formType}-${fileDate}-${Math.random()}`,
        ticker,
        company,
        formType, // Use the requested form type directly - this is guaranteed correct
        fileDate: fileDate || '—',
        filedTimeET,
        filedTimeAM,
        periodOfReport: s.period_of_report || '—',
      }
    })
  } catch { return [] }
}

export async function POST(req: NextRequest) {
  try {
    const { formTypes = ['8-K', '4', '10-Q'], hours = 24 } = await req.json()
    const from = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString().split('T')[0]

    const results = await Promise.all(formTypes.map((ft: string) => fetchFormType(ft, from)))
    const allHits = results.flat()

    const seen = new Set<string>()
    const filings = allHits
      .filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true })
      .sort((a, b) => b.fileDate.localeCompare(a.fileDate))

    return NextResponse.json({ filings, total: filings.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message, filings: [], total: 0 }, { status: 500 })
  }
}
