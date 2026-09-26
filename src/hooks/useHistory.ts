'use client'
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'ep_analyzer_history'
const MAX_ENTRIES = 200

export type Verdict = 'TRADE' | 'WAIT' | 'SKIP'

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

function persist(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // localStorage can throw (private mode, quota) -- history just won't persist across reloads
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
