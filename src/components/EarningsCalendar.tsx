'use client'
import { useState, useEffect, Fragment } from 'react'
import { useKeys } from '@/lib/keys'

export default function EarningsCalendar() {
  const { keys } = useKeys()
  const [earnings, setEarnings] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [period, setPeriod] = useState<'today' | 'past' | 'future'>('today')
  const [historyView, setHistoryView] = useState<'quarterly' | 'annually'>('quarterly')
  const [growthMode, setGrowthMode] = useState<'yoy' | 'qoq'>('yoy')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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

  const today = new Date().toISOString().split('T')[0]

  const filtered = earnings.filter(e => {
    if (!(!filter || e.symbol?.toLowerCase().includes(filter.toLowerCase()))) return false
    if (period === 'today') return e.date === today
    return period === 'past' ? e.date < today : e.date > today
  })

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

  function formatQuarterLabel(d: string) {
    if (!d) return '—'
    const date = new Date(d + 'T00:00:00')
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }

  function formatYearLabel(y: number) {
    return String(y)
  }

  function isToday(d: string) {
    return d === today
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
  function fmtCap(val: any) {
    if (val == null) return '—'
    const n = Number(val)
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
    return `$${n.toFixed(0)}`
  }

  function toggleExpanded(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const segStyle = (active: boolean): React.CSSProperties => ({
    padding: '0 14px', height: 36, fontSize: 13, border: 'none', cursor: 'pointer',
    background: active ? '#1a1a18' : '#fff', color: active ? '#fff' : '#6b6b68', fontWeight: active ? 600 : 400
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#9b9b98', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Period</div>
          <div style={{ display: 'flex', border: '1px solid #e5e5e3', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setPeriod('past')} style={segStyle(period === 'past')}>Past 7 days</button>
            <button onClick={() => setPeriod('today')} style={segStyle(period === 'today')}>Today</button>
            <button onClick={() => setPeriod('future')} style={segStyle(period === 'future')}>Next 7 days</button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#9b9b98', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>History</div>
          <div style={{ display: 'flex', border: '1px solid #e5e5e3', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setHistoryView('quarterly')} style={segStyle(historyView === 'quarterly')}>Quarterly</button>
            <button onClick={() => setHistoryView('annually')} style={segStyle(historyView === 'annually')}>Annually</button>
          </div>
        </div>
        {historyView === 'quarterly' && (
          <div>
            <div style={{ fontSize: 11, color: '#9b9b98', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Compare vs.</div>
            <div style={{ display: 'flex', border: '1px solid #e5e5e3', borderRadius: 8, overflow: 'hidden' }}>
              <button onClick={() => setGrowthMode('yoy')} style={segStyle(growthMode === 'yoy')}>YoY</button>
              <button onClick={() => setGrowthMode('qoq')} style={segStyle(growthMode === 'qoq')}>QoQ</button>
            </div>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 11, color: '#9b9b98', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Search</div>
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Filter by ticker..."
            style={{ maxWidth: 240, fontSize: 14, height: 36, width: '100%' }} />
        </div>
        <button onClick={load} disabled={loading}
          style={{ background: '#1a1a18', color: '#fff', padding: '0 16px', height: 36, fontSize: 13, borderRadius: 8, border: 'none', cursor: 'pointer' }}>
          {loading ? 'Loading...' : 'Refresh ↻'}
        </button>
      </div>

      <div style={{ fontSize: 13, color: '#6b6b68', marginBottom: '1rem' }}>
        {filtered.length} companies · growth always vs. same quarter last year (O'Neil/Bonde style){period === 'today' ? ' · market cap and 8-quarter history available (click a row)' : ' · full history available on the Today tab to stay within API limits'}
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: '1rem' }}>{error}</div>}

      {!keys.finnhub && !keys.fmp && (
        <div style={{ background: '#fffbeb', color: '#d97706', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: '1rem' }}>
          ⚠️ Please save your Finnhub or FMP API key above to load the earnings calendar.
        </div>
      )}
      {keys.finnhub && !keys.fmp && (
        <div style={{ background: '#eff6ff', color: '#2563eb', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: '1rem' }}>
          ℹ️ Капитализация и история EPS/Sales за 8 кварталов уже работают через Finnhub одни, без FMP.
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
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e5e3', background: '#f8f8f7' }}>
                    {['Ticker', 'Mkt Cap', 'When', 'EPS', 'EPS Growth (YoY)', 'Revenue', 'Rev Growth (YoY)', 'EPS Surprise %', 'Rev Surprise %'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#9b9b98', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byDate[date].map((e: any, i: number) => {
                    const key = `${e.symbol}_${e.date}`
                    const tl = timeLabel(e.time)
                    const reported = e.epsActual != null
                    const epsSurprisePct = reported && e.epsEstimated ? ((e.epsActual - e.epsEstimated) / Math.abs(e.epsEstimated)) * 100 : null
                    const revenueSurprisePct = reported && e.revenueActual != null && e.revenueEstimated ? ((e.revenueActual - e.revenueEstimated) / Math.abs(e.revenueEstimated)) * 100 : null
                    const isOpen = expanded.has(key)
                    const historyRows = historyView === 'quarterly' ? e.quarterlyHistory : e.annualHistory
                    const hasHistory = Array.isArray(historyRows) && historyRows.length > 0
                    const hasAnyHistory = (Array.isArray(e.quarterlyHistory) && e.quarterlyHistory.length > 0) || (Array.isArray(e.annualHistory) && e.annualHistory.length > 0)
                    return (
                      <Fragment key={key}>
                        <tr onClick={() => hasAnyHistory && toggleExpanded(key)}
                          style={{ borderBottom: isOpen ? 'none' : (i < byDate[date].length - 1 ? '1px solid #e5e5e3' : 'none'), cursor: hasAnyHistory ? 'pointer' : 'default' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 700, color: '#2563eb' }}>
                            {hasAnyHistory && <span style={{ display: 'inline-block', width: 12, color: '#9b9b98', fontSize: 10 }}>{isOpen ? '▼' : '▶'}</span>}
                            {e.symbol}
                          </td>
                          <td style={{ padding: '8px 12px', color: '#6b6b68' }}>{fmtCap(e.marketCap)}</td>
                          <td style={{ padding: '8px 12px' }}>
                            {tl ? <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: tl.bg, color: tl.color, fontWeight: 500 }}>{tl.label}</span> : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', fontWeight: 500 }}>
                            {reported ? `$${Number(e.epsActual).toFixed(2)}` : e.epsEstimated != null ? `$${Number(e.epsEstimated).toFixed(2)} (est)` : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', color: pctColor(e.epsGrowthPctYoy), fontWeight: 500 }}>{fmtPct(e.epsGrowthPctYoy)}</td>
                          <td style={{ padding: '8px 12px', color: '#6b6b68' }}>
                            {reported ? fmtRevenue(e.revenueActual) : e.revenueEstimated != null ? `${fmtRevenue(e.revenueEstimated)} (est)` : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', color: pctColor(e.revenueGrowthPctYoy), fontWeight: 500 }}>{fmtPct(e.revenueGrowthPctYoy)}</td>
                          <td style={{ padding: '8px 12px', color: epsSurprisePct!=null?pctColor(epsSurprisePct):'#9b9b98', fontWeight: 700 }}>{epsSurprisePct!=null?fmtPct(epsSurprisePct):'—'}</td>
                          <td style={{ padding: '8px 12px', color: revenueSurprisePct!=null?pctColor(revenueSurprisePct):'#9b9b98', fontWeight: 700 }}>{revenueSurprisePct!=null?fmtPct(revenueSurprisePct):'—'}</td>
                        </tr>
                        {isOpen && hasAnyHistory && (
                          <tr style={{ borderBottom: i < byDate[date].length - 1 ? '1px solid #e5e5e3' : 'none' }}>
                            <td colSpan={9} style={{ padding: '0 12px 12px 32px', background: '#f8f8f7' }}>
                              <div style={{ fontSize: 11, color: '#9b9b98', margin: '8px 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                {historyView === 'quarterly' ? 'Quarterly' : 'Annual'} EPS &amp; Sales (O'Neil/Bonde style — vs. {historyView === 'quarterly' ? (growthMode === 'yoy' ? 'same quarter last year' : 'previous quarter') : 'same year last year'})
                              </div>
                              {hasHistory ? (
                                <>
                                  <table style={{ width: '100%', maxWidth: 560, borderCollapse: 'collapse', fontSize: 12 }}>
                                    <thead>
                                      <tr>
                                        {[historyView === 'quarterly' ? 'Quarter' : 'Year', 'EPS ($)', '%Chg', 'EPS Surprise %', 'Sales', '%Chg'].map((h, hi) => (
                                          <th key={hi} style={{ padding: '4px 8px', textAlign: 'left', fontSize: 10, color: '#9b9b98', fontWeight: 500 }}>{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {historyRows.map((q: any, qi: number) => {
                                        const epsChgPct = historyView === 'quarterly' ? (growthMode === 'yoy' ? q.epsYoyPct : q.epsQoqPct) : q.epsYoyPct
                                        const revChgPct = historyView === 'quarterly' ? (growthMode === 'yoy' ? q.revenueYoyPct : q.revenueQoqPct) : q.revenueYoyPct
                                        return (
                                          <tr key={qi}>
                                            <td style={{ padding: '4px 8px', fontWeight: 500 }}>{historyView === 'quarterly' ? formatQuarterLabel(q.date) : formatYearLabel(q.year)}</td>
                                            <td style={{ padding: '4px 8px' }}>{q.eps != null ? `$${Number(q.eps).toFixed(2)}` : '—'}</td>
                                            <td style={{ padding: '4px 8px', color: pctColor(epsChgPct) }}>{fmtPct(epsChgPct)}</td>
                                            <td style={{ padding: '4px 8px', color: q.epsSurprisePct!=null?pctColor(q.epsSurprisePct):'#9b9b98' }}>{q.epsSurprisePct!=null?fmtPct(q.epsSurprisePct):'—'}</td>
                                            <td style={{ padding: '4px 8px' }}>{fmtRevenue(q.revenue)}</td>
                                            <td style={{ padding: '4px 8px', color: pctColor(revChgPct) }}>{fmtPct(revChgPct)}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                  <div style={{ fontSize: 10, color: '#9b9b98', marginTop: 6 }}>
                                    EPS is as-reported (GAAP) — can look choppy for companies with one-time charges (M&amp;A, impairments), which is normal.
                                    {historyView === 'quarterly' && ' EPS Surprise % is only available for the last ~4 quarters (Finnhub free tier limit); revenue surprise has no free historical source, so it isn’t shown here — only on today’s own report above.'}
                                  </div>
                                </>
                              ) : (
                                <div style={{ fontSize: 12, color: '#9b9b98', padding: '4px 0' }}>No {historyView} data available for this company.</div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}

      {!loading && dates.length === 0 && !error && (keys.finnhub || keys.fmp) && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#9b9b98', fontSize: 14 }}>
          {period === 'past' ? 'No earnings found in the past 7 days' : period === 'today' ? 'No earnings found today' : 'No earnings found in the next 7 days'}
        </div>
      )}
    </div>
  )
}
