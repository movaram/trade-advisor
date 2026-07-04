'use client'
import { useState } from 'react'
import { useKeys } from '@/lib/keys'
import Badge from './Badge'
import { fetchScan, detectCatalysts, catalystScore } from '@/lib/api'

export default function CatalystScanner({ onDeepDive }: { onDeepDive: (ticker: string) => void }) {
  const { keys } = useKeys()
  const [input, setInput] = useState('')
  const [watchlist, setWatchlist] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<any[]>([])
  const [error, setError] = useState('')

  function add() {
    const v = input.trim().toUpperCase()
    if (!v || watchlist.includes(v) || watchlist.length >= 15) return
    setWatchlist(w => [...w, v])
    setInput('')
  }

  function remove(t: string) { setWatchlist(w => w.filter(x => x !== t)) }

  async function scan() {
    if (!keys.finnhub) { setError('Please save your Finnhub API key above.'); return }
    if (!watchlist.length) return
    setError(''); setScanning(true); setResults([]); setProgress(0)
    const out: any[] = []
    for (let i = 0; i < watchlist.length; i++) {
      const ticker = watchlist[i]
      try {
        const data = await fetchScan(ticker, keys.finnhub)
        const catalysts = detectCatalysts(data.filings, data.insiders, data.news, data.sentiment, data.recs)
        const score = catalystScore(catalysts)
        out.push({ ticker, profile: data.profile, catalysts, score })
      } catch {
        out.push({ ticker, profile: null, catalysts: [], score: { level: 'error', label: 'Error', color: 'gray' } })
      }
      setProgress(Math.round(((i + 1) / watchlist.length) * 100))
    }
    const order: Record<string, number> = { hot: 0, risk: 1, watch: 2, mild: 3, clean: 4, error: 5 }
    out.sort((a, b) => (order[a.score.level] ?? 4) - (order[b.score.level] ?? 4))
    setResults(out)
    setScanning(false)
  }

  const hotC = results.filter(r => r.score.level === 'hot').length
  const riskC = results.filter(r => r.score.level === 'risk').length
  const watchC = results.filter(r => r.score.level === 'watch').length

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Watchlist — up to 15 tickers</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input value={input} onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="e.g. TSLA" style={{ maxWidth: 160, fontWeight: 500 }} />
          <button onClick={add} style={{ background: 'var(--text)', color: '#fff', padding: '0 16px', height: 38 }}>Add</button>
        </div>
        {watchlist.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {watchlist.map(t => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '4px 12px', fontSize: 13 }}>
                {t}
                <button onClick={() => remove(t)} style={{ background: 'none', color: 'var(--text-3)', fontSize: 16, lineHeight: 1, padding: 0, border: 'none' }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red)', padding: '10px 14px', borderRadius: 8, marginBottom: '1rem', fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: '1.5rem' }}>
        <button onClick={scan} disabled={scanning || !watchlist.length}
          style={{ background: 'var(--text)', color: '#fff', padding: '0 20px', height: 38 }}>
          {scanning ? `Scanning... ${progress}%` : 'Scan for catalysts →'}
        </button>
        {results.length > 0 && (
          <button onClick={() => { setResults([]); setProgress(0) }}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '0 16px', height: 38 }}>
            Clear
          </button>
        )}
      </div>

      {scanning && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
          <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8 }}>Scanning {watchlist.length} tickers...</div>
          <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--accent)', width: progress + '%', transition: 'width 0.3s', borderRadius: 2 }} />
          </div>
        </div>
      )}

      {results.length > 0 && (
        <>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {[['Hot catalysts', hotC, 'var(--green)'], ['Risk events', riskC, 'var(--red)'], ['Worth watching', watchC, 'var(--yellow)'], ['Total scanned', results.length, 'var(--text)']].map(([label, count, color]) => (
              <div key={String(label)}>
                <span style={{ fontSize: 22, fontWeight: 600, color: String(color) }}>{count}</span>
                <span style={{ fontSize: 12, color: 'var(--text-2)', marginLeft: 6 }}>{label}</span>
              </div>
            ))}
          </div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '0 1.25rem' }}>
            {results.map((r, i) => (
              <div key={r.ticker} style={{ display: 'grid', gridTemplateColumns: '80px 1fr auto', alignItems: 'start', gap: 12, padding: '12px 0', borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{r.ticker}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{r.profile?.name ? r.profile.name.split(' ').slice(0, 2).join(' ') : ''}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {r.catalysts.length > 0
                    ? r.catalysts.slice(0, 3).map((c: any, ci: number) => (
                      <div key={ci} style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', gap: 6 }}>
                        <span>{c.icon}</span><span>{c.text}</span>
                      </div>
                    ))
                    : <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No significant events detected</div>
                  }
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                  <Badge label={r.score.label} color={r.score.color} />
                  <button onClick={() => onDeepDive(r.ticker)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 12px', fontSize: 12, borderRadius: 6 }}>
                    Deep dive →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
