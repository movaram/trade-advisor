'use client'
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'ep_analyzer_history'
const MAX_ENTRIES = 500
// localStorage gives the site ~5M characters. A full result is ~45K, almost all of it the news
// list, so only the newest entries keep every news item; older ones keep the analysis (with the
// catalyst explanation) plus just the catalyst news item (~5K). 20 full + 480 compact ≈ 3.3M,
// where storing everything in full would silently stop saving after ~110 entries.
const FULL_NEWS_ENTRIES = 20

export type Verdict = 'TRADE' | 'WAIT' | 'SKIP'

export type VerdictStrength =
  | 'STRONG TRADE' | 'TRADE' | 'TRADE WITH CAUTION'
  | 'WAIT - STRONG CATALYST' | 'WAIT'
  | 'SKIP' | 'SKIP - WEAK CATALYST'

export type SetupType = 'EP' | 'MOMENTUM' | 'DEP' | 'FAILED_BREAKOUT'

export type HistoryEntry = {
  id: string
  ticker: string
  company_name: string
  event_date: string
  analyzed_at: string
  catalyst_type: string
  catalyst_number: number | null
  rank: number
  ep_score: number
  verdict: Verdict
  // Optional: entries saved before the Catalyst Strength feature won't have these.
  catalyst_strength?: number
  catalyst_strength_label?: string
  combined_score?: number
  verdict_strength?: VerdictStrength
  // Optional: entries saved before the Setup Classification feature won't have these.
  setup_type?: SetupType
  setup_score?: number
  has_action_plan?: boolean
  price_change: number
  volume_ratio: number
  full_result: any
}

export function parseCatalystNumber(catalystType: string | undefined): number | null {
  if (!catalystType) return null
  const m = catalystType.match(/#(\d+)/)
  return m ? Number(m[1]) : null
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function compact(entry: HistoryEntry): HistoryEntry {
  const result = entry.full_result
  if (!result?.news) return entry
  const { catalyst_news_url: catalystUrl, catalyst_news_date: catalystDate } = result.analysis ?? {}
  const news = result.news
    .filter((n: any) => catalystUrl ? n.url === catalystUrl : catalystDate && n.published_date === catalystDate && n.url)
    .slice(0, 1)
  return { ...entry, full_result: { ...result, news } }
}

function persist(entries: HistoryEntry[]) {
  // On a quota error, compact more and more entries; as a last resort drop the oldest ones, so
  // a new analysis is always saved rather than the whole write failing silently.
  for (let keepFull = FULL_NEWS_ENTRIES, keepCount = entries.length; keepCount > 0; ) {
    const stored = entries.slice(0, keepCount).map((e, i) => (i < keepFull ? e : compact(e)))
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
      return
    } catch {
      // private mode or quota
      if (keepFull > 0) keepFull = 0
      else keepCount = Math.floor(keepCount * 0.9)
    }
  }
}

export function useHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setHistory(loadHistory())
    setLoaded(true)
  }, [])

  const addEntry = useCallback((entry: HistoryEntry) => {
    setHistory(prev => {
      const next = [entry, ...prev].slice(0, MAX_ENTRIES)
      persist(next)
      return next
    })
  }, [])

  const deleteEntry = useCallback((id: string) => {
    setHistory(prev => {
      const next = prev.filter(e => e.id !== id)
      persist(next)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setHistory([])
    persist([])
  }, [])

  return { history, loaded, addEntry, deleteEntry, clearAll }
}
