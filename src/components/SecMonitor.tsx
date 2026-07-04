'use client'
import { useState } from 'react'
import { fetchFilings } from '@/lib/api'

export default function SecMonitor() {
  const [ticker, setTicker] = useState('')
  const [loading, setLoading] = useState(false)
  const [filings, setFilings] = useState<any[]>([])
  const [error, setError] = useState('')

  async function load() {
    const sym = ticker.trim().toUpperCase()
    if (!sym) return
    setError(''); setLoading(true); setFilings([])
    try {
      const data = await fetchFilings(sym)
      setFilings(data.filings || [])
    } catch (e: any) {
      setError('Error: ' + e.message)
    }
    setLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: '1.5rem' }}>
        <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && load()}
          placeholder="e.g. AAPL" style={{ fontSize: 16, fontWeight: 500, maxWidth: 220 }} />
        <button onClick={load} disabled={loading}
          style={{ background: 'var(--text)', color: '#fff', padding: '0 20px', height: 38 }}>
          {loading ? 'Loading...' : 'Load filings →'}
        </button>
      </div>

      {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red)', padding: '10px 14px', borderRadius: 8, marginBottom: '1rem', fontSize: 13 }}>{error}</div>}

      {filings.length === 0 && !loading && !error && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-3)', fontSize: 14 }}>
          Enter a ticker to load SEC filings from the last 90 days
        </div>
      )}

      {filings.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '0 1.25rem' }}>
          <div style={{ padding: '12px 0', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>
            📁 SEC Filings — {ticker} <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-2)' }}>({filings.length} found)</span>
          </div>
          {filings.map((f, i) => {
            const s = f._source || {}
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < filings.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--accent-bg)', color: 'var(--accent)', whiteSpace: 'nowrap' }}>{s.form_type || '?'}</span>
                <span style={{ flex: 1, fontSize: 13 }}>{s.entity_name || ticker}</span>
                {s.period_of_report && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Period: {s.period_of_report}</span>}
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{s.file_date || ''}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
