'use client'
import { useState, useEffect } from 'react'
import { useKeys } from '@/lib/keys'

export default function EarningsCalendar() {
  const { keys } = useKeys()
  const [earnings, setEarnings] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if ((keys.finnhub || keys.fmp) && !loaded) {
      load()
      setLoaded(true)
    }
  }, [keys.finnhub, keys.fmp])

  async function load() {
    if (!keys.finnhub && !keys.fmp) {
      setError('Please save your API keys first.')
      return
    }
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/earnings-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fmpKey: keys.fmp, finnhubKey: keys.finnhub })
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setEarnings(data.earnings || [])
    } catch (e: any) {
      setError('Error loading earnings: ' + e.message)
    }
    setLoading(false)
  }

  const filtered = earnings.filter(e =>
    !filter || e.symbol?.toLowerCase().includes(filter.toLowerCase())
  )

  // Group by date
  const byDate: Record<string, any[]> = {}
  filtered.forEach((e: any) => {
    const date = e.date || e.reportDate || '—'
    if (!byDate[date]) byDate[date] = []
    byDate[date].push(e)
  })
  const dates = Object.keys(byDate).sort()

  function formatDate(d: string) {
    if (!d || d === '—') return d
    const date = new Date(d + 'T00:00:00')
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  }

  function isToday(d: string) {
    return d === new Date().toISOString().split('T')[0]
  }

  function isTomorrow(d: string) {
    const tom = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    return d === tom
  }

  function timeLabel(time: string) {
    if (!time) return null
    if (time === 'bmo' || time.toLowerCase().includes('before')) return { label: 'Pre-market', bg: '#eff6ff', color: '#2563eb' }
    if (time === 'amc' || time.toLowerCase().includes('after')) return { label: 'After-hours', bg: '#fffbeb', color: '#d97706' }
    return { label: time, bg: '#f1f5f9', color: '#64748b' }
  }

  function pctColor(val: any) {
    const n = Number(val); if (val == null || isNaN(n)) return '#9b9b98'
    return n >= 0 ? '#16a34a' : '#dc2626'
  }
  function fmtPct(val: any) {
    if (val == null || isNaN(Number(val))) return '—'
    const n = Number(val); return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
  }
  function fmtRevenue(val: any) {
    if (val == null) return '—'
    const n = Number(val)
    return Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(1)}M`
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter by ticker..."
          style={{ maxWidth: 240, fontSize: 14, height: 36 }} />
        <button onClick={load} disabled={loading}
          style={{ background: '#1a1a18', color: '#fff', padding: '0 16px', height: 36, fontSize: 13, borderRadius: 8, border: 'none', cursor: 'pointer' }}>
          {loading ? 'Loading...' : 'Refresh ↻'}
        </button>
        <span style={{ fontSize: 13, color: '#6b6b68' }}>
          Past 7 + next 7 days · {filtered.length} companies · &gt;$30M market cap, US-listed
        </span>
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: '1rem' }}>{error}</div>}

      {!keys.finnhub && !keys.fmp && (
        <div style={{ background: '#fffbeb', color: '#d97706', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: '1rem' }}>
          ⚠️ Please save your Finnhub or FMP API key above to load the earnings calendar.
        </div>
      )}
      {keys.finnhub && !keys.fmp && (
        <div style={{ background: '#fffbeb', color: '#d97706', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: '1rem' }}>
          ⚠️ Без FMP-ключа недоступны: фильтр по капитализации/бирже и % роста год-к-году.
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: '2rem', color: '#6b6b68' }}>Loading earnings calendar...</div>}

      {!loading && dates.map(date => (
        <div key={date} style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{formatDate(date)}</span>
            {isToday(date) && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#dc2626', color: '#fff' }}>TODAY</span>}
            {isTomorrow(date) && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: '#2563eb', color: '#fff' }}>TOMORROW</span>}
            <span style={{ fontSize: 12, color: '#9b9b98' }}>{byDate[date].length} companies</span>
          </div>
          <div style={{ background: '#fff', border: '1px solid #e5e5e3', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e5e3', background: '#f8f8f7' }}>
                  {['Ticker', 'When', 'EPS', 'EPS Growth YoY', 'Revenue', 'Rev Growth YoY', 'Surprise %'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#9b9b98', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byDate[date].map((e: any, i: number) => {
                  const tl = timeLabel(e.time)
                  const reported = e.epsActual != null
                  const surprisePct = reported && e.epsEstimated ? ((e.epsActual - e.epsEstimated) / Math.abs(e.epsEstimated)) * 100 : null
                  return (
                    <tr key={i} style={{ borderBottom: i < byDate[date].length - 1 ? '1px solid #e5e5e3' : 'none' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 700, color: '#2563eb' }}>{e.symbol}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {tl ? <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: tl.bg, color: tl.color, fontWeight: 500 }}>{tl.label}</span> : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: 500 }}>
                        {reported ? `$${Number(e.epsActual).toFixed(2)}` : e.epsEstimated != null ? `$${Number(e.epsEstimated).toFixed(2)} (est)` : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', color: pctColor(e.epsGrowthPct), fontWeight: 500 }}>{fmtPct(e.epsGrowthPct)}</td>
                      <td style={{ padding: '8px 12px', color: '#6b6b68' }}>
                        {reported ? fmtRevenue(e.revenueActual) : e.revenueEstimated != null ? `${fmtRevenue(e.revenueEstimated)} (est)` : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', color: pctColor(e.revenueGrowthPct), fontWeight: 500 }}>{fmtPct(e.revenueGrowthPct)}</td>
                      <td style={{ padding: '8px 12px', color: surprisePct!=null?pctColor(surprisePct):'#9b9b98', fontWeight: 700 }}>{surprisePct!=null?fmtPct(surprisePct):'—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {!loading && dates.length === 0 && !error && (keys.finnhub || keys.fmp) && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#9b9b98', fontSize: 14 }}>
          No earnings found in the past/next 7 days
        </div>
      )}
    </div>
  )
}
