// Search history and result cache using localStorage
const HISTORY_KEY = 'ta_search_history'
const CACHE_KEY = 'ta_result_cache'
const MAX_HISTORY = 50
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

export interface HistoryItem {
  ticker: string
  timestamp: number
  companyName?: string
}

export function getHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function addToHistory(ticker: string, companyName?: string) {
  try {
    const history = getHistory().filter(h => h.ticker !== ticker)
    history.unshift({ ticker, timestamp: Date.now(), companyName })
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
  } catch {}
}

export function getCachedResult(ticker: string): any | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const cache = raw ? JSON.parse(raw) : {}
    const entry = cache[ticker]
    if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
      return entry.data
    }
    return null
  } catch { return null }
}

export function setCachedResult(ticker: string, data: any) {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const cache = raw ? JSON.parse(raw) : {}
    // Keep only last 20 cached results
    const keys = Object.keys(cache)
    if (keys.length >= 20) {
      const oldest = keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp)[0]
      delete cache[oldest]
    }
    cache[ticker] = { data, timestamp: Date.now() }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {}
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY)
    localStorage.removeItem(CACHE_KEY)
  } catch {}
}
