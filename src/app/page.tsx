'use client'
import { useState } from 'react'
import { useHistory, parseCatalystNumber, type HistoryEntry } from '@/hooks/useHistory'
import HistoryTable from '@/components/HistoryTable'
import HistoryStats from '@/components/HistoryStats'
import Toast from '@/components/Toast'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type AnalystConfirmation = {
  analyst_count: number
  highest_tier: 'T1' | 'T2' | 'T3'
  max_pt_raise_pct: number
  summary: string
}

type Checklist = {
  q1_ignored: boolean; q1_explanation: string
  q2_volume: boolean; q2_explanation: string
  q3_better_than_expected: boolean; q3_explanation: string
  q4_narrative: boolean; q4_explanation: string
  q5_technical: boolean; q5_explanation: string
  analyst_confirmation: AnalystConfirmation | null
}

type Analysis = {
  catalyst_type: string
  catalyst_description: string
  rank: number
  rank_explanation: string
  checklist: Checklist
  ep_score: number
  verdict: 'TRADE' | 'WAIT' | 'SKIP'
  verdict_color: string
  key_risks: string[]
  similar_setups: string[]
}

type NewsItem = {
  title: string
  description: string | null
  publisher: string | null
  url?: string | null
  source_tier?: number
  origin?: 'massive' | 'web_search'
}

type Result = {
  ticker: string
  company_name: string
  date: string
  price: { open: number; high: number; low: number; close: number; volume: number }
  price_change_pct: number
  volume_ratio: number
  ytd_move_30d_pct: number
  above_21ema: boolean | null
  above_50sma: boolean | null
  news: NewsItem[]
  analysis: Analysis
}

function rankColor(rank: number) {
  if (rank >= 8) return 'text-green-400'
  if (rank >= 5) return 'text-yellow-400'
  return 'text-red-400'
}

function pctColor(v: number) {
  return v >= 0 ? 'text-green-400' : 'text-red-400'
}

function fmtPct(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function toDDMMYYYY(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}.${m}.${y}`
}

const verdictStyles: Record<string, { bg: string; border: string; text: string; emoji: string }> = {
  TRADE: { bg: 'bg-green-950', border: 'border-green-600', text: 'text-green-400', emoji: '✅' },
  WAIT: { bg: 'bg-yellow-950', border: 'border-yellow-600', text: 'text-yellow-400', emoji: '⚠️' },
  SKIP: { bg: 'bg-red-950', border: 'border-red-600', text: 'text-red-400', emoji: '❌' },
}

const tierLabel: Record<number, string> = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' }

const tierBadge: Record<string, string> = {
  T1: 'bg-amber-950 border-amber-600 text-amber-300',
  T2: 'bg-gray-800 border-gray-500 text-gray-300',
  T3: 'bg-gray-900 border-gray-700 text-gray-500',
}

function ChecklistRow({ label, pass, explanation }: { label: string; pass: boolean; explanation: string }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-800 last:border-0">
      <span className="text-lg leading-none mt-0.5">{pass ? '✅' : '❌'}</span>
      <div>
        <div className="text-sm font-medium text-gray-200">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{explanation}</div>
      </div>
    </div>
  )
}

export default function Home() {
  const [tab, setTab] = useState<'analyze' | 'history'>('analyze')
  const [ticker, setTicker] = useState('')
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [newsOpen, setNewsOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const { history, addEntry, deleteEntry, clearAll } = useHistory()

  function saveToHistory(data: Result) {
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      ticker: data.ticker,
      company_name: data.company_name,
      event_date: toDDMMYYYY(data.date),
      analyzed_at: new Date().toISOString(),
      catalyst_type: data.analysis.catalyst_type,
      catalyst_number: parseCatalystNumber(data.analysis.catalyst_type),
      rank: data.analysis.rank,
      ep_score: data.analysis.ep_score,
      verdict: data.analysis.verdict,
      price_change: data.price_change_pct,
      volume_ratio: data.volume_ratio,
      full_result: data,
    }
    addEntry(entry)
    setToastMessage('✓ Saved to history')
  }

  async function handleAnalyze() {
    if (!ticker.trim() || !date) {
      setError('Enter a ticker and a date.')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const r = await fetch(`${API_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: ticker.trim().toUpperCase(), date }),
      })
      if (!r.ok) {
        let detail = 'Unexpected error.'
        try {
          const body = await r.json()
          detail = body.detail || detail
        } catch {}
        if (r.status === 429) detail = 'Rate limit, try again.'
        throw new Error(detail)
      }
      const data: Result = await r.json()
      setResult(data)
      setNewsOpen(false)
      saveToHistory(data)
    } catch (e: any) {
      setError(e.message || 'Failed to reach the analysis server.')
    }
    setLoading(false)
  }

  function handleViewHistoryEntry(entry: HistoryEntry) {
    setResult(entry.full_result)
    setNewsOpen(false)
    setError('')
    setTab('analyze')
  }

  const v = result ? verdictStyles[result.analysis.verdict] || verdictStyles.WAIT : null

  return (
    <main className="min-h-screen bg-[#0a0e14] text-gray-100">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-white">EP Analyzer</h1>
          <p className="text-sm text-gray-500 mt-1">Episodic Pivot Catalyst Intelligence</p>
        </header>

        <div className="flex gap-2 mb-8 border-b border-gray-800">
          <button
            onClick={() => setTab('analyze')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'analyze' ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >
            🔍 Analyze
          </button>
          <button
            onClick={() => setTab('history')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'history' ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >
            📋 History {history.length > 0 && <span className="text-gray-600">({history.length})</span>}
          </button>
        </div>

        {tab === 'analyze' && (
          <>
            <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 mb-8 flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="flex-1">
                <label className="block text-xs uppercase tracking-wide text-gray-500 mb-1">Ticker</label>
                <input
                  value={ticker}
                  onChange={e => setTicker(e.target.value.toUpperCase())}
                  placeholder="AEHR"
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs uppercase tracking-wide text-gray-500 mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                />
              </div>
              <button
                onClick={handleAnalyze}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm rounded-lg px-6 py-2 flex items-center justify-center gap-2 transition-colors"
              >
                {loading && (
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                )}
                {loading ? 'Analyzing…' : 'Analyze'}
              </button>
            </div>

            {error && (
              <div className="bg-red-950/60 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3 mb-8">
                {error}
              </div>
            )}

            {result && (
              <div className="space-y-4">
                {/* Card 1 — Catalyst */}
                <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">{result.ticker} · {result.company_name}</div>
                      <span className="inline-block bg-blue-950 border border-blue-700 text-blue-300 text-xs font-semibold px-3 py-1 rounded-full mb-3">
                        {result.analysis.catalyst_type}
                      </span>
                      <p className="text-sm text-gray-300 leading-relaxed max-w-lg">{result.analysis.catalyst_description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-4xl font-bold ${rankColor(result.analysis.rank)}`}>{result.analysis.rank}<span className="text-lg text-gray-600">/10</span></div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-3">{result.analysis.rank_explanation}</p>
                </div>

                {/* Card 2 — Price Action */}
                <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
                  <h2 className="text-xs uppercase tracking-wide text-gray-500 mb-3">Price Action</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Price change</div>
                      <div className={`text-lg font-semibold ${pctColor(result.price_change_pct)}`}>{fmtPct(result.price_change_pct)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Volume</div>
                      <div className="text-lg font-semibold text-white">{result.volume_ratio.toFixed(1)}x avg</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">vs 21 EMA</div>
                      <div className={`text-lg font-semibold ${result.above_21ema == null ? 'text-gray-500' : result.above_21ema ? 'text-green-400' : 'text-red-400'}`}>
                        {result.above_21ema == null ? '—' : result.above_21ema ? 'Above' : 'Below'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">vs 50 SMA</div>
                      <div className={`text-lg font-semibold ${result.above_50sma == null ? 'text-gray-500' : result.above_50sma ? 'text-green-400' : 'text-red-400'}`}>
                        {result.above_50sma == null ? '—' : result.above_50sma ? 'Above' : 'Below'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-800 text-xs text-gray-500">
                    30-day move: <span className={pctColor(result.ytd_move_30d_pct)}>{fmtPct(result.ytd_move_30d_pct)}</span>
                    {' · '}O {result.price.open} · H {result.price.high} · L {result.price.low} · C {result.price.close}
                  </div>
                </div>

                {/* Card 3 — EP Checklist */}
                <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
                  <h2 className="text-xs uppercase tracking-wide text-gray-500 mb-1">EP Checklist</h2>
                  <ChecklistRow label="Q1: Stock was ignored before catalyst" pass={result.analysis.checklist.q1_ignored} explanation={result.analysis.checklist.q1_explanation} />
                  <ChecklistRow label="Q2: +5%+ on 2x volume" pass={result.analysis.checklist.q2_volume} explanation={result.analysis.checklist.q2_explanation} />
                  <ChecklistRow label="Q3: Better than expected" pass={result.analysis.checklist.q3_better_than_expected} explanation={result.analysis.checklist.q3_explanation} />
                  <ChecklistRow label="Q4: Narrative for new buyers" pass={result.analysis.checklist.q4_narrative} explanation={result.analysis.checklist.q4_explanation} />
                  <ChecklistRow label="Q5: Technical position" pass={result.analysis.checklist.q5_technical} explanation={result.analysis.checklist.q5_explanation} />
                  {result.analysis.checklist.analyst_confirmation && (
                    <div className="mt-3 pt-3 border-t border-gray-800 flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-xs uppercase tracking-wide text-gray-500">Analyst Confirmation:</span>
                      <span className="font-semibold text-white">{result.analysis.checklist.analyst_confirmation.analyst_count} analysts</span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${tierBadge[result.analysis.checklist.analyst_confirmation.highest_tier] || tierBadge.T3}`}>
                        {result.analysis.checklist.analyst_confirmation.highest_tier}
                      </span>
                      <span className="text-green-400 font-semibold">max PT +{result.analysis.checklist.analyst_confirmation.max_pt_raise_pct}%</span>
                    </div>
                  )}
                </div>

                {/* Card 4 — Verdict */}
                {v && (
                  <div className={`${v.bg} border ${v.border} rounded-xl p-6 text-center`}>
                    <div className={`text-3xl font-bold ${v.text} mb-1`}>{v.emoji} {result.analysis.verdict}</div>
                    <div className="text-sm text-gray-400 mb-4">Score: {result.analysis.ep_score}/5</div>
                    {result.analysis.key_risks?.length > 0 && (
                      <div className="text-left max-w-md mx-auto mt-4 pt-4 border-t border-gray-800/60">
                        <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Key Risks</div>
                        <ul className="text-sm text-gray-300 list-disc list-inside space-y-1">
                          {result.analysis.key_risks.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      </div>
                    )}
                    {result.analysis.similar_setups?.length > 0 && (
                      <div className="text-xs text-gray-500 mt-4">Similar setups: {result.analysis.similar_setups.join(', ')}</div>
                    )}
                  </div>
                )}

                {/* Card 5 — News */}
                <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
                  <button onClick={() => setNewsOpen(o => !o)} className="w-full flex items-center justify-between text-xs uppercase tracking-wide text-gray-500">
                    <span>News ({result.news.length})</span>
                    <span>{newsOpen ? '▲' : '▼'}</span>
                  </button>
                  {newsOpen && (
                    <div className="mt-3 space-y-3">
                      {result.news.length === 0 && <div className="text-sm text-gray-500">No news found for this date.</div>}
                      {result.news.map((n, i) => (
                        <div key={i} className="border-b border-gray-800 last:border-0 pb-3 last:pb-0">
                          <div className="text-sm font-medium text-gray-200">{n.title}</div>
                          <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                            {n.publisher && <span>{n.publisher}</span>}
                            {n.source_tier != null && <span className="text-gray-600">· {tierLabel[n.source_tier] || `Tier ${n.source_tier}`}</span>}
                            {n.origin === 'web_search' && <span className="text-gray-600">· via web search</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <div className="space-y-4">
            <HistoryStats history={history} />
            <HistoryTable
              history={history}
              onView={handleViewHistoryEntry}
              onDelete={deleteEntry}
              onClearAll={clearAll}
              onGoToAnalyze={() => setTab('analyze')}
            />
          </div>
        )}
      </div>

      {toastMessage && <Toast message={toastMessage} onDone={() => setToastMessage(null)} />}
    </main>
  )
}
