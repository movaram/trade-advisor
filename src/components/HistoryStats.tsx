'use client'
import type { HistoryEntry } from '@/hooks/useHistory'

export default function HistoryStats({ history }: { history: HistoryEntry[] }) {
  const total = history.length
  const trade = history.filter(h => h.verdict === 'TRADE').length
  const wait = history.filter(h => h.verdict === 'WAIT').length
  const skip = history.filter(h => h.verdict === 'SKIP').length
  const avgRank = total ? history.reduce((s, h) => s + (h.rank || 0), 0) / total : 0
  const avgScore = total ? history.reduce((s, h) => s + (h.ep_score || 0), 0) / total : 0

  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2 items-center bg-gray-900/60 border border-gray-800 rounded-xl px-5 py-4 text-sm text-gray-400">
      <div>Total: <b className="text-white">{total}</b></div>
      <div>TRADE: <b className="text-green-400">{trade}</b></div>
      <div>WAIT: <b className="text-yellow-400">{wait}</b></div>
      <div>SKIP: <b className="text-red-400">{skip}</b></div>
      <div className="sm:ml-auto">Avg Rank: <b className="text-white">{avgRank.toFixed(1)}</b></div>
      <div>Avg EP Score: <b className="text-white">{avgScore.toFixed(1)}/5</b></div>
    </div>
  )
}
