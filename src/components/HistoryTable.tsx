'use client'
import { useMemo, useState } from 'react'
import type { HistoryEntry, Verdict, VerdictStrength } from '@/hooks/useHistory'

function rankColor(rank: number) {
  if (rank >= 8) return 'text-green-400'
  if (rank >= 5) return 'text-yellow-400'
  return 'text-red-400'
}

const verdictBadge: Record<Verdict, string> = {
  TRADE: 'bg-green-950 border-green-600 text-green-400',
  WAIT: 'bg-yellow-950 border-yellow-600 text-yellow-400',
  SKIP: 'bg-red-950 border-red-600 text-red-400',
}

const verdictStrengthBadge: Record<VerdictStrength, string> = {
  'STRONG TRADE': 'bg-green-950 border-green-500 text-green-300',
  'TRADE': 'bg-green-950 border-green-600 text-green-400',
  'TRADE WITH CAUTION': 'bg-teal-950 border-teal-600 text-teal-400',
  'WAIT - STRONG CATALYST': 'bg-yellow-950 border-yellow-500 text-yellow-300',
  'WAIT': 'bg-yellow-950 border-yellow-600 text-yellow-400',
  'SKIP': 'bg-red-950 border-red-600 text-red-400',
  'SKIP - WEAK CATALYST': 'bg-red-950 border-red-800 text-red-500',
}

const strengthLabelColor: Record<string, string> = {
  Exceptional: 'text-green-400',
  Strong: 'text-green-400',
  Moderate: 'text-yellow-400',
  Weak: 'text-orange-400',
  Noise: 'text-red-400',
}

function ScoreDots({ score }: { score: number }) {
  return (
    <span className="tracking-wider text-gray-500" title={`${score}/5`}>
      {Array.from({ length: 5 }, (_, i) => (i < score ? '●' : '○')).join('')}
    </span>
  )
}

function toCsv(rows: HistoryEntry[]): string {
  const header = ['Ticker', 'EventDate', 'Catalyst#', 'CatalystName', 'Rank', 'EPScore', 'CatalystStrength', 'CombinedScore', 'Verdict', 'PriceChange%', 'VolumeRatio']
  const escape = (v: any) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const catalystName = (e: HistoryEntry) => e.catalyst_type?.replace(/^#\d+\s*—\s*/, '') ?? ''
  const lines = [header.join(',')]
  for (const e of rows) {
    lines.push([
      escape(e.ticker), escape(e.event_date), escape(e.catalyst_number ?? ''), escape(catalystName(e)),
      escape(e.rank), escape(e.ep_score), escape(e.catalyst_strength ?? ''), escape(e.combined_score ?? ''),
      escape(e.verdict_strength ?? e.verdict), escape(e.price_change), escape(e.volume_ratio),
    ].join(','))
  }
  return lines.join('\n')
}

function downloadCsv(rows: HistoryEntry[]) {
  const csv = toCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ep_analyzer_history_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function HistoryTable({
  history,
  onView,
  onDelete,
  onClearAll,
  onGoToAnalyze,
}: {
  history: HistoryEntry[]
  onView: (entry: HistoryEntry) => void
  onDelete: (id: string) => void
  onClearAll: () => void
  onGoToAnalyze: () => void
}) {
  const [filter, setFilter] = useState<'ALL' | Verdict>('ALL')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'rank_desc' | 'rank_asc'>('newest')
  const [confirmingClear, setConfirmingClear] = useState(false)

  const filtered = useMemo(() => {
    let rows = history
    if (filter !== 'ALL') rows = rows.filter(e => e.verdict === filter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(e => e.ticker?.toLowerCase().includes(q))
    }
    rows = [...rows].sort((a, b) => {
      switch (sortBy) {
        case 'oldest': return (a.analyzed_at || '').localeCompare(b.analyzed_at || '')
        case 'rank_desc': return (b.rank || 0) - (a.rank || 0)
        case 'rank_asc': return (a.rank || 0) - (b.rank || 0)
        default: return (b.analyzed_at || '').localeCompare(a.analyzed_at || '')
      }
    })
    return rows
  }, [history, filter, search, sortBy])

  if (history.length === 0) {
    return (
      <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-10 text-center">
        <p className="text-gray-400 mb-4">No analyses yet. Run your first analysis →</p>
        <button
          onClick={onGoToAnalyze}
          className="bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-lg px-5 py-2 transition-colors"
        >
          Go to Analyze
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex border border-gray-700 rounded-lg overflow-hidden">
          {(['ALL', 'TRADE', 'WAIT', 'SKIP'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-950 text-gray-400 hover:text-gray-200'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by ticker..."
          className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500 w-40"
        />
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as any)}
          className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="rank_desc">Rank (high→low)</option>
          <option value="rank_asc">Rank (low→high)</option>
        </select>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => downloadCsv(filtered)}
            className="border border-gray-700 hover:border-gray-500 text-gray-300 text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
          >
            Export CSV
          </button>
          {confirmingClear ? (
            <button
              onClick={() => { onClearAll(); setConfirmingClear(false) }}
              className="bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
            >
              Confirm clear all?
            </button>
          ) : (
            <button
              onClick={() => setConfirmingClear(true)}
              onBlur={() => setConfirmingClear(false)}
              className="border border-red-900 hover:border-red-600 text-red-400 text-xs font-medium rounded-lg px-3 py-1.5 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[920px]">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Ticker</th>
                <th className="px-4 py-3 font-medium">Event Date</th>
                <th className="px-4 py-3 font-medium">Catalyst</th>
                <th className="px-4 py-3 font-medium">Rank</th>
                <th className="px-4 py-3 font-medium">EP Score</th>
                <th className="px-4 py-3 font-medium">CS</th>
                <th className="px-4 py-3 font-medium">Combined</th>
                <th className="px-4 py-3 font-medium">Verdict</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} className="border-b border-gray-800/60 last:border-0 hover:bg-gray-800/30">
                  <td className="px-4 py-3 font-bold text-white">{e.ticker}</td>
                  <td className="px-4 py-3 text-gray-400">{e.event_date}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block bg-blue-950 border border-blue-800 text-blue-300 text-xs px-2 py-0.5 rounded-full whitespace-nowrap">
                      {e.catalyst_number != null ? `#${e.catalyst_number}` : ''} {e.catalyst_type?.replace(/^#\d+\s*—\s*/, '')}
                    </span>
                  </td>
                  <td className={`px-4 py-3 font-semibold ${rankColor(e.rank)}`}>{e.rank}</td>
                  <td className="px-4 py-3"><ScoreDots score={e.ep_score} /></td>
                  <td className="px-4 py-3">
                    {e.catalyst_strength != null ? (
                      <span className={`font-semibold ${strengthLabelColor[e.catalyst_strength_label || ''] || 'text-gray-400'}`}>
                        {e.catalyst_strength}/15
                      </span>
                    ) : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{e.combined_score != null ? `${e.combined_score}/20` : <span className="text-gray-600">—</span>}</td>
                  <td className="px-4 py-3">
                    {e.verdict_strength ? (
                      <span className={`inline-block border text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${verdictStrengthBadge[e.verdict_strength] || verdictStrengthBadge.WAIT}`}>
                        {e.verdict_strength}
                      </span>
                    ) : (
                      <span className={`inline-block border text-xs font-semibold px-2 py-0.5 rounded-full ${verdictBadge[e.verdict] || verdictBadge.WAIT}`}>
                        {e.verdict}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button onClick={() => onView(e)} className="text-blue-400 hover:text-blue-300 text-xs font-medium mr-3">View</button>
                    <button onClick={() => onDelete(e.id)} className="text-red-400 hover:text-red-300 text-xs font-medium">× Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
