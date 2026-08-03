'use client'
import { useState, useEffect, Fragment } from 'react'
import { useKeys } from '@/lib/keys'

// Market cap, SEC quarterly/annual history, and historical EPS surprise% barely change within a
// trading day -- once fetched for a symbol there's no need to ask Finnhub/SEC for it again until
// tomorrow. This cache is what lets auto-refresh poll often without re-spending the per-symbol API
// budget on every tick (see route.ts CLIENT_CACHE_TTL_MS for the matching server-side check).
const ENRICHMENT_CACHE_KEY = 'ta_earnings_enrichment_cache_v1'
const ENRICHMENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const AUTO_REFRESH_MS = 60 * 1000

type CachedEnrichment = {
  marketCap?: number | null; industry?: string | null; sector?: string | null;
  pctFromWeek52High?: number | null; pctFromWeek52Low?: number | null;
  rsWeekPct?: number | null; rsMonthPct?: number | null;
  quarterlyHistory?: any[]; annualHistory?: any[]; cachedAt: number
}

function loadEnrichmentCache(): Record<string, CachedEnrichment> {
  try {
    const raw = localStorage.getItem(ENRICHMENT_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    const now = Date.now()
    const pruned: Record<string, CachedEnrichment> = {}
    Object.keys(parsed).forEach(sym => {
      if (parsed[sym]?.cachedAt != null && now - parsed[sym].cachedAt < ENRICHMENT_CACHE_TTL_MS) pruned[sym] = parsed[sym]
    })
    return pruned
  } catch { return {} }
}

function saveEnrichmentCache(cache: Record<string, CachedEnrichment>) {
  try { localStorage.setItem(ENRICHMENT_CACHE_KEY, JSON.stringify(cache)) } catch {}
}

export default function EarningsCalendar() {
  const { keys } = useKeys()
  const [earnings, setEarnings] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [period, setPeriod] = useState<'today' | 'past' | 'future'>('today')
  const [showPreMarket, setShowPreMarket] = useState(true)
  const [showAfterHours, setShowAfterHours] = useState(true)
  const [historyView, setHistoryView] = useState<'quarterly' | 'annually'>('quarterly')
  const [growthMode, setGrowthMode] = useState<'yoy' | 'qoq'>('yoy')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    if ((keys.finnhub || keys.fmp) && !loaded) {
      load()
      setLoaded(true)
    }
  }, [keys.finnhub, keys.fmp])

  // Auto-refresh only re-checks the calendar (cheap, not per-symbol) -- symbols already cached from
  // an earlier load this session skip Finnhub/SEC entirely, so polling every minute stays well within
  // both providers' limits. Paused while the tab is hidden so a forgotten background tab doesn't spend
  // API calls for nothing.
  useEffect(() => {
    if (!keys.finnhub && !keys.fmp) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true })
    }, AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [keys.finnhub, keys.fmp])

  async function load(opts?: { silent?: boolean }) {
    if (!keys.finnhub && !keys.fmp) {
      setError('Please save your API keys first.')
      return
    }
    if (opts?.silent) setRefreshing(true); else setLoading(true)
    setError('')
    try {
      const cache = loadEnrichmentCache()
      const r = await fetch('/api/earnings-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fmpKey: keys.fmp, finnhubKey: keys.finnhub, cachedEnrichment: cache })
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      const nextEarnings = data.earnings || []
      const nextCache = { ...cache }
      nextEarnings.forEach((e: any) => {
        if (e.marketCap != null || e.industry || (Array.isArray(e.quarterlyHistory) && e.quarterlyHistory.length > 0)) {
          nextCache[e.symbol] = {
            marketCap: e.marketCap, industry: e.industry, sector: e.sector,
            pctFromWeek52High: e.pctFromWeek52High, pctFromWeek52Low: e.pctFromWeek52Low,
            rsWeekPct: e.rsWeekPct, rsMonthPct: e.rsMonthPct,
            quarterlyHistory: e.quarterlyHistory, annualHistory: e.annualHistory, cachedAt: Date.now()
          }
        }
      })
      saveEnrichmentCache(nextCache)
      setEarnings(nextEarnings)
      setLastUpdated(Date.now())
    } catch (e: any) {
      setError('Error loading earnings: ' + e.message)
    }
    if (opts?.silent) setRefreshing(false); else setLoading(false)
  }

  const today = new Date().toISOString().split('T')[0]

  function timeCategory(time: string): 'pre' | 'after' | 'other' {
    if (!time) return 'other'
    if (time === 'bmo' || time.toLowerCase().includes('before')) return 'pre'
    if (time === 'amc' || time.toLowerCase().includes('after')) return 'after'
    return 'other'
  }

  const filtered = earnings.filter(e => {
    if (!(!filter || e.symbol?.toLowerCase().includes(filter.toLowerCase()))) return false
    if (period === 'today') { if (e.date !== today) return false } else { if (!(period === 'past' ? e.date < today : e.date > today)) return false }
    if (showPreMarket && showAfterHours) return true // nothing narrowed down -- show everything, including unclassified rows
    const cat = timeCategory(e.time)
    return (cat === 'pre' && showPreMarket) || (cat === 'after' && showAfterHours)
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

  function getSortValue(e: any, col: string): number | string | null {
    switch (col) {
      case 'ticker': return e.symbol || ''
      case 'marketCap': return e.marketCap
      case 'eps': return e.epsActual ?? e.epsEstimated
      case 'epsGrowth': return e.epsGrowthPctYoy
      case 'revenue': return e.revenueActual ?? e.revenueEstimated
      case 'revenueGrowth': return e.revenueGrowthPctYoy
      case 'epsSurprise': {
        const reported = e.epsActual != null
        return reported && e.epsEstimated ? ((e.epsActual - e.epsEstimated) / Math.abs(e.epsEstimated)) * 100 : null
      }
      case 'revenueSurprise': {
        const reported = e.epsActual != null
        return reported && e.revenueActual != null && e.revenueEstimated ? ((e.revenueActual - e.revenueEstimated) / Math.abs(e.revenueEstimated)) * 100 : null
      }
      default: return null
    }
  }

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function sortRows(rows: any[]): any[] {
    if (!sortCol) return rows
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = getSortValue(a, sortCol)
      const vb = getSortValue(b, sortCol)
      if (va == null && vb == null) return 0
      if (va == null) return 1 // nulls always sort last, regardless of direction
      if (vb == null) return -1
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dir
      return (Number(va) - Number(vb)) * dir
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
          <div style={{ fontSize: 11, color: '#9b9b98', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>When</div>
          <div style={{ display: 'flex', gap: 12, height: 36, alignItems: 'center', border: '1px solid #e5e5e3', borderRadius: 8, padding: '0 12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: '#6b6b68' }}>
              <input type="checkbox" checked={showPreMarket} onChange={e => setShowPreMarket(e.target.checked)} />
              Pre-market
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: '#6b6b68' }}>
              <input type="checkbox" checked={showAfterHours} onChange={e => setShowAfterHours(e.target.checked)} />
              After-hours
            </label>
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
        <div>
          <button onClick={() => load()} disabled={loading}
            style={{ background: '#1a1a18', color: '#fff', padding: '0 16px', height: 36, fontSize: 13, borderRadius: 8, border: 'none', cursor: 'pointer' }}>
            {loading ? 'Loading...' : 'Refresh ↻'}
          </button>
          {lastUpdated != null && (
            <div style={{ fontSize: 10, color: '#9b9b98', marginTop: 4, textAlign: 'center' }}>
              {refreshing ? 'updating…' : `updated ${new Date(lastUpdated).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 13, color: '#6b6b68', marginBottom: '1rem' }}>
        {filtered.length} companies · growth always vs. same quarter last year (O'Neil/Bonde style){period === 'today' ? ' · market cap and 8-quarter history available (click a row)' : ' · full history available on the Today tab to stay within API limits'} · auto-refreshes every minute
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
                    {[
                      { label: 'Ticker', key: 'ticker' },
                      { label: 'Mkt Cap', key: 'marketCap' },
                      { label: 'When' },
                      { label: 'EPS', key: 'eps' },
                      { label: 'EPS Growth (YoY)', key: 'epsGrowth' },
                      { label: 'Revenue', key: 'revenue' },
                      { label: 'Rev Growth (YoY)', key: 'revenueGrowth' },
                      { label: 'EPS Surprise %', key: 'epsSurprise' },
                      { label: 'Rev Surprise %', key: 'revenueSurprise' },
                    ].map(h => (
                      <th key={h.label} onClick={() => h.key && toggleSort(h.key)}
                        style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#9b9b98', fontWeight: 500, whiteSpace: 'nowrap', cursor: h.key ? 'pointer' : 'default', userSelect: 'none' }}>
                        {h.label}{h.key && sortCol === h.key ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortRows(byDate[date]).map((e: any, i: number) => {
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
                            <td colSpan={9} style={{ padding: '0 32px 12px 32px', background: '#f8f8f7' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '8px 0 6px', gap: 16, flexWrap: 'wrap' }}>
                                <div style={{ fontSize: 11, color: '#9b9b98', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                  {historyView === 'quarterly' ? 'Quarterly' : 'Annual'} EPS &amp; Sales (O'Neil/Bonde style — vs. {historyView === 'quarterly' ? (growthMode === 'yoy' ? 'same quarter last year' : 'previous quarter') : 'same year last year'})
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: '#6b6b68', alignItems: 'flex-end' }}>
                                  {e.sector && <div>Sector: <b style={{ color: '#1a1a18' }}>{e.sector}</b></div>}
                                  {e.industry && <div>Industry: <b style={{ color: '#1a1a18' }}>{e.industry}</b></div>}
                                  {e.rsWeekPct != null && <div>RS 1W vs SPY: <b style={{ color: pctColor(e.rsWeekPct) }}>{fmtPct(e.rsWeekPct)}</b></div>}
                                  {e.rsMonthPct != null && <div>RS 1M vs SPY: <b style={{ color: pctColor(e.rsMonthPct) }}>{fmtPct(e.rsMonthPct)}</b></div>}
                                  {e.pctFromWeek52High != null && <div>vs 52W High: <b style={{ color: pctColor(e.pctFromWeek52High) }}>{fmtPct(e.pctFromWeek52High)}</b></div>}
                                  {e.pctFromWeek52Low != null && <div>vs 52W Low: <b style={{ color: pctColor(e.pctFromWeek52Low) }}>{fmtPct(e.pctFromWeek52Low)}</b></div>}
                                </div>
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
                                    {' RS and vs 52W High/Low use the latest daily close (not live intraday price); only shown for the first 10 today\'s-reporters per load to stay within Finnhub\'s free-tier rate limit.'}
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
