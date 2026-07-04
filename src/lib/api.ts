export interface CatalystEvent {
  icon: string
  text: string
  weight: number
  type: 'bullish' | 'bearish' | 'filing' | 'insider' | 'attention'
  importance: 'high' | 'medium' | 'low'
}

export async function fetchScan(ticker: string, finnhub: string) {
  const r = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker, finnhub })
  })
  return r.json()
}

export async function fetchFilings(ticker: string, types?: string[]) {
  const r = await fetch('/api/filings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker, types })
  })
  return r.json()
}

export function detectCatalysts(
  filings: any, insiders: any, news: any, sentiment: any, recs: any
): CatalystEvent[] {
  const events: CatalystEvent[] = []

  const filingsArr = Array.isArray(filings) ? filings : []
  const insidersArr = Array.isArray(insiders) ? insiders : (insiders?.data || [])
  const newsArr = Array.isArray(news) ? news : []
  const recsArr = Array.isArray(recs) ? recs : []

  const eightK = filingsArr.filter((f: any) => (f._source?.form_type || '').includes('8-K'))
  if (eightK.length > 0)
    events.push({ icon: '📋', text: `${eightK.length} new 8-K filing${eightK.length > 1 ? 's' : ''} — material event`, weight: 4, type: 'filing', importance: 'high' })

  const form4 = filingsArr.filter((f: any) => (f._source?.form_type || '').includes('4'))
  if (form4.length > 0)
    events.push({ icon: '👤', text: `${form4.length} insider transaction${form4.length > 1 ? 's' : ''} filed`, weight: 2, type: 'insider', importance: 'medium' })

  const buyVal = insidersArr.filter((i: any) => i.transactionType === 'P').reduce((s: number, i: any) => s + (Math.abs(i.share || 0) * Math.abs(i.price || 0)), 0)
  const sellVal = insidersArr.filter((i: any) => i.transactionType === 'S').reduce((s: number, i: any) => s + (Math.abs(i.share || 0) * Math.abs(i.price || 0)), 0)

  if (buyVal > 500000) events.push({ icon: '📈', text: `Large insider buying: $${(buyVal / 1e6).toFixed(2)}M`, weight: 4, type: 'bullish', importance: 'high' })
  else if (buyVal > 100000) events.push({ icon: '📈', text: `Insider buying: $${(buyVal / 1e6).toFixed(2)}M`, weight: 2, type: 'bullish', importance: 'medium' })
  if (sellVal > 2000000) events.push({ icon: '📉', text: `Heavy insider selling: $${(sellVal / 1e6).toFixed(2)}M`, weight: 3, type: 'bearish', importance: 'high' })
  else if (sellVal > 500000) events.push({ icon: '📉', text: `Insider selling: $${(sellVal / 1e6).toFixed(2)}M`, weight: 2, type: 'bearish', importance: 'medium' })

  const bull = sentiment?.sentiment?.bullishPercent
  const articles = sentiment?.buzz?.articlesInLastWeek || 0

  if (articles > 20) events.push({ icon: '🔥', text: `Very high news activity: ${articles} articles this week`, weight: 2, type: 'attention', importance: 'medium' })
  else if (articles > 10) events.push({ icon: '📰', text: `Elevated news volume: ${articles} articles this week`, weight: 1, type: 'attention', importance: 'low' })

  if (bull != null && bull > 0.75) events.push({ icon: '🟢', text: `Strong bullish sentiment: ${(bull * 100).toFixed(0)}% positive`, weight: 2, type: 'bullish', importance: 'medium' })
  else if (bull != null && bull < 0.25) events.push({ icon: '🔴', text: `Bearish sentiment: only ${(bull * 100).toFixed(0)}% positive`, weight: 2, type: 'bearish', importance: 'medium' })

  if (recsArr.length > 0) {
    const r = recsArr[0]
    const up = (r.strongBuy || 0) + (r.buy || 0)
    const down = (r.strongSell || 0) + (r.sell || 0)
    const total = up + (r.hold || 0) + down
    if (total > 5) {
      if (up > down * 3) events.push({ icon: '⭐', text: `Strong analyst consensus: ${up} buy vs ${down} sell (${total} total)`, weight: 3, type: 'bullish', importance: 'high' })
      else if (up > down * 1.5) events.push({ icon: '⭐', text: `Bullish analysts: ${up} buy vs ${down} sell`, weight: 2, type: 'bullish', importance: 'medium' })
      else if (down > up * 2) events.push({ icon: '⚠️', text: `Bearish analysts: ${down} sell vs ${up} buy`, weight: 3, type: 'bearish', importance: 'high' })
    }
  }

  // News quality signals
  const upgrades = newsArr.filter((n: any) => n.headline?.toLowerCase().includes('upgrade') || n.headline?.toLowerCase().includes('outperform')).length
  const downgrades = newsArr.filter((n: any) => n.headline?.toLowerCase().includes('downgrade') || n.headline?.toLowerCase().includes('underperform')).length
  const earningsNews = newsArr.filter((n: any) => n.headline?.toLowerCase().includes('beat') || n.headline?.toLowerCase().includes('miss') || n.headline?.toLowerCase().includes('earn')).length

  if (upgrades > 0) events.push({ icon: '⬆️', text: `${upgrades} analyst upgrade${upgrades > 1 ? 's' : ''} in recent news`, weight: 2, type: 'bullish', importance: 'medium' })
  if (downgrades > 0) events.push({ icon: '⬇️', text: `${downgrades} analyst downgrade${downgrades > 1 ? 's' : ''} in recent news`, weight: 2, type: 'bearish', importance: 'medium' })
  if (earningsNews > 0) events.push({ icon: '💰', text: `${earningsNews} earnings-related news item${earningsNews > 1 ? 's' : ''}`, weight: 2, type: 'attention', importance: 'high' })

  return events.sort((a, b) => b.weight - a.weight)
}

export function catalystScore(events: CatalystEvent[]) {
  if (!events.length) return { level: 'clean', label: 'Clean', color: 'green' }
  const total = events.reduce((s, e) => s + e.weight, 0)
  const highImpact = events.filter(e => e.importance === 'high')
  const hasBearish = events.some(e => e.type === 'bearish')
  const hasBullish = events.some(e => e.type === 'bullish' || e.type === 'filing')
  const hasHighBullish = highImpact.some(e => e.type === 'bullish' || e.type === 'filing')
  const hasHighBearish = highImpact.some(e => e.type === 'bearish')

  if (hasHighBullish && !hasBearish) return { level: 'hot', label: '🔥 Hot catalyst', color: 'green' }
  if (hasHighBearish) return { level: 'risk', label: '⚠️ Risk events', color: 'red' }
  if (total >= 5 && hasBullish && !hasBearish) return { level: 'watch', label: '👀 Worth watching', color: 'yellow' }
  if (hasBearish && hasBullish) return { level: 'mixed', label: '↔️ Mixed signals', color: 'yellow' }
  if (total >= 3) return { level: 'mild', label: 'Mild activity', color: 'blue' }
  return { level: 'clean', label: '✓ Clean', color: 'green' }
}

export function fmt(val: number | null | undefined, pre = '', suf = '', dec = 2): string {
  if (val == null || isNaN(val)) return 'N/A'
  return pre + Number(val).toFixed(dec) + suf
}
