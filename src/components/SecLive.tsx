'use client'
import { useState, useEffect, useRef } from 'react'
import { useKeys } from '@/lib/keys'

const ALL_FORM_TYPES = ['8-K', '10-Q', '10-K', '4', 'S-1', 'SC 13G', 'SC 13D']
const VISIBLE_LIMIT = 30

// Convert an SEC/Finnhub wall-clock timestamp (always US Eastern Time) into a real Date,
// correctly handling EST/EDT — Finnhub's acceptedDate has no timezone marker of its own.
function etOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(instant)
  const tzName = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-5'
  const m = tzName.match(/GMT([+-]\d+)/)
  return m ? parseInt(m[1], 10) * 60 : -300
}
function etWallClockToDate(s: string): Date | null {
  if (!s) return null
  const guess = new Date(s.replace(' ', 'T') + 'Z')
  if (isNaN(guess.getTime())) return null
  const offsetMin = etOffsetMinutes(guess)
  return new Date(guess.getTime() - offsetMin * 60000)
}

const FORM_STYLE: Record<string, { bg: string; color: string; impact: string; impactColor: string }> = {
  '8-K':    { bg: '#fef2f2', color: '#dc2626', impact: '🔴 High impact', impactColor: '#dc2626' },
  '10-Q':   { bg: '#eff6ff', color: '#2563eb', impact: '🔵 Quarterly report', impactColor: '#2563eb' },
  '10-K':   { bg: '#eff6ff', color: '#2563eb', impact: '🔵 Annual report', impactColor: '#2563eb' },
  '4':      { bg: '#fffbeb', color: '#d97706', impact: '🟡 Insider transaction', impactColor: '#d97706' },
  'S-1':    { bg: '#f0fdf4', color: '#16a34a', impact: '🟢 IPO filing', impactColor: '#16a34a' },
  'SC 13G': { bg: '#f8fafc', color: '#64748b', impact: '⚪ Institutional', impactColor: '#64748b' },
  'SC 13D': { bg: '#f8fafc', color: '#64748b', impact: '⚪ Institutional', impactColor: '#64748b' },
}

const REFRESH_SEC = 30

function FormBadge({ type }: { type: string }) {
  const s = FORM_STYLE[type] || { bg: '#f1f5f9', color: '#64748b' }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {type || '?'}
    </span>
  )
}

export default function SecLive() {
  const { keys } = useKeys()
  const [allFilings, setAllFilings] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [hours, setHours] = useState(24)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [countdown, setCountdown] = useState(REFRESH_SEC)
  const [filter, setFilter] = useState('')
  const [newCount, setNewCount] = useState(0)
  const [activeTab, setActiveTab] = useState('all')
  const [timezone, setTimezone] = useState<'ET' | 'AM'>('ET')
  const [realTimes, setRealTimes] = useState<Record<string, any[]>>({})
  const intervalRef = useRef<any>(null)
  const countdownRef = useRef<any>(null)
  const prevIdsRef = useRef<Set<string>>(new Set())

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const r = await fetch('/api/sec-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formTypes: ALL_FORM_TYPES, hours })
      })
      const data = await r.json()
      const incoming = data.filings || []
      if (prevIdsRef.current.size > 0) {
        const newOnes = incoming.filter((f: any) => !prevIdsRef.current.has(f.id))
        if (newOnes.length > 0) setNewCount(n => n + newOnes.length)
      }
      prevIdsRef.current = new Set(incoming.map((f: any) => f.id))
      setAllFilings(incoming)
      setLastUpdate(new Date())
    } catch (e) { console.error(e) }
    if (!silent) setLoading(false)
  }

  function startTimers() {
    clearInterval(intervalRef.current)
    clearInterval(countdownRef.current)
    setCountdown(REFRESH_SEC)
    intervalRef.current = setInterval(() => { load(true); setCountdown(REFRESH_SEC) }, REFRESH_SEC * 1000)
    countdownRef.current = setInterval(() => setCountdown(c => c > 1 ? c - 1 : REFRESH_SEC), 1000)
  }

  useEffect(() => { load(); startTimers(); return () => { clearInterval(intervalRef.current); clearInterval(countdownRef.current) } }, [])
  useEffect(() => {
    if (autoRefresh) startTimers()
    else { clearInterval(intervalRef.current); clearInterval(countdownRef.current) }
    return () => { clearInterval(intervalRef.current); clearInterval(countdownRef.current) }
  }, [autoRefresh, hours])

  const filtered = allFilings.filter(f => {
    const matchesSearch = !filter ||
      (f.ticker && f.ticker !== '—' && f.ticker.toLowerCase().includes(filter.toLowerCase())) ||
      f.company?.toLowerCase().includes(filter.toLowerCase()) ||
      f.formType?.toLowerCase().includes(filter.toLowerCase())
    const matchesTab = activeTab === 'all' || f.formType === activeTab
    return matchesSearch && matchesTab
  })

  // Exact filing time comes from Finnhub and is only fetched for the rows actually shown,
  // to stay well under Finnhub's free-tier rate limit.
  const visible = filtered.slice(0, VISIBLE_LIMIT)

  useEffect(() => {
    if (!keys.finnhub) return
    const tickers = Array.from(new Set(visible.map(f => f.ticker))).filter(t => t && t !== '—' && !realTimes[t])
    if (tickers.length === 0) return
    fetch('/api/sec-filing-times', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers, finnhubKey: keys.finnhub })
    }).then(r => r.json()).then(data => {
      if (data.times) setRealTimes(prev => ({ ...prev, ...data.times }))
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.map(f => f.ticker).join(','), keys.finnhub])

  function getRealTime(f: any): Date | null {
    const list = realTimes[f.ticker]
    if (!list) return null
    const candidates = list.filter((x: any) => x.form === f.formType)
    if (candidates.length === 0) return null

    // EDGAR's search-index file_date and Finnhub's filedDate occasionally disagree by a day
    // (different indexing conventions), so prefer an exact match but allow a small tolerance.
    const exact = candidates.find((x: any) => x.filedDate?.startsWith(f.fileDate))
    const targetTime = new Date(f.fileDate).getTime()
    const nearest = exact || candidates.reduce((best: any, c: any) => {
      const diff = Math.abs(new Date(c.filedDate).getTime() - targetTime)
      const bestDiff = best ? Math.abs(new Date(best.filedDate).getTime() - targetTime) : Infinity
      return diff < bestDiff ? c : best
    }, null)
    if (!nearest) return null
    const diffDays = Math.abs(new Date(nearest.filedDate).getTime() - targetTime) / 86400000
    if (diffDays > 2) return null

    return etWallClockToDate(nearest.acceptedDate)
  }

  const countByType = ALL_FORM_TYPES.reduce((acc, t) => {
    acc[t] = allFilings.filter(f => f.formType === t).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div>
      {/* Status bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {autoRefresh
          ? <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 99, background: '#f0fdf4', color: '#16a34a', fontWeight: 600 }}>🟢 LIVE · {countdown}s</span>
          : <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 99, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0' }}>⏸ Paused</span>
        }
        {newCount > 0 && (
          <span onClick={() => setNewCount(0)} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 99, background: '#fef2f2', color: '#dc2626', fontWeight: 600, cursor: 'pointer' }}>
            🔔 {newCount} new · dismiss
          </span>
        )}
        {lastUpdate && <span style={{ fontSize: 12, color: '#9b9b98' }}>Updated: {lastUpdate.toLocaleTimeString()}</span>}
        <span style={{ fontSize: 12, color: '#9b9b98' }}>{allFilings.length} filings loaded</span>
      </div>

      {/* Controls */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e3', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 11, color: '#9b9b98', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Search</div>
            <input value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="Ticker or company..."
              style={{ height: 36, fontSize: 14, width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#9b9b98', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time range</div>
            <select value={hours} onChange={e => { setHours(Number(e.target.value)) }}
              style={{ height: 36, padding: '0 10px', border: '1px solid #e5e5e3', borderRadius: 8, fontSize: 13, background: '#fff' }}>
              <option value={1}>Last 1 hour</option>
              <option value={4}>Last 4 hours</option>
              <option value={12}>Last 12 hours</option>
              <option value={24}>Last 24 hours</option>
              <option value={48}>Last 48 hours</option>
              <option value={168}>Last week</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#9b9b98', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timezone</div>
            <div style={{ display: 'flex', border: '1px solid #e5e5e3', borderRadius: 8, overflow: 'hidden' }}>
              {(['ET', 'AM'] as const).map(tz => (
                <button key={tz} onClick={() => setTimezone(tz)} style={{
                  padding: '0 14px', height: 36, fontSize: 13, border: 'none', cursor: 'pointer',
                  background: timezone === tz ? '#1a1a18' : '#fff',
                  color: timezone === tz ? '#fff' : '#6b6b68', fontWeight: timezone === tz ? 600 : 400
                }}>{tz === 'ET' ? '🇺🇸 ET' : '🇦🇲 AM'}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => { load(); setNewCount(0) }} disabled={loading}
              style={{ background: '#1a1a18', color: '#fff', padding: '0 16px', height: 36, fontSize: 13, borderRadius: 8, border: 'none', cursor: 'pointer' }}>
              {loading ? 'Loading...' : 'Refresh ↻'}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
              Auto (30s)
            </label>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #e5e5e3', marginBottom: '1rem', overflowX: 'auto' }}>
        <button onClick={() => setActiveTab('all')} style={{
          padding: '6px 14px', fontSize: 13, background: 'none', border: 'none',
          borderBottom: activeTab === 'all' ? '2px solid #1a1a18' : '2px solid transparent',
          color: activeTab === 'all' ? '#1a1a18' : '#6b6b68', cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1
        }}>All ({allFilings.length})</button>
        {ALL_FORM_TYPES.filter(t => countByType[t] > 0).map(t => (
          <button key={t} onClick={() => setActiveTab(activeTab === t ? 'all' : t)} style={{
            padding: '6px 14px', fontSize: 13, background: 'none', border: 'none',
            borderBottom: activeTab === t ? `2px solid ${FORM_STYLE[t]?.color || '#1a1a18'}` : '2px solid transparent',
            color: activeTab === t ? (FORM_STYLE[t]?.color || '#1a1a18') : '#6b6b68',
            cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1, fontWeight: activeTab === t ? 600 : 400
          }}>{t} ({countByType[t]})</button>
        ))}
      </div>

      {!keys.finnhub && filtered.length > 0 && (
        <div style={{ background: '#fffbeb', color: '#d97706', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: '1rem' }}>
          ⚠️ Добавьте Finnhub API ключ выше, чтобы видеть точное время подачи (иначе показывается только дата).
        </div>
      )}

      {/* Table */}
      {filtered.length > 0 ? (
        <>
          <div style={{ background: '#fff', border: '1px solid #e5e5e3', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e5e3', background: '#f8f8f7' }}>
                  {['Ticker', 'Company', 'Form', 'Impact', 'Date', `Time (${timezone})`, 'Period', 'Doc'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#9b9b98', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((f: any, i: number) => {
                  const fs = FORM_STYLE[f.formType]
                  const isHighImpact = f.formType === '8-K'
                  const realTime = getRealTime(f)
                  const timeLabel = realTime
                    ? realTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: timezone === 'ET' ? 'America/New_York' : 'Asia/Yerevan' }) + (timezone === 'ET' ? ' ET' : ' AM')
                    : (f.ticker === '—' || !keys.finnhub || realTimes[f.ticker] ? '—' : '…')
                  return (
                    <tr key={i} style={{
                      borderBottom: i < visible.length - 1 ? '1px solid #e5e5e3' : 'none',
                      background: isHighImpact ? '#fff8f8' : 'transparent'
                    }}>
                      <td style={{ padding: '8px 12px', fontWeight: 700, color: f.ticker !== '—' ? '#2563eb' : '#9b9b98' }}>{f.ticker}</td>
                      <td style={{ padding: '8px 12px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.company}>{f.company}</td>
                      <td style={{ padding: '8px 12px' }}><FormBadge type={f.formType} /></td>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: fs?.impactColor || '#9b9b98', whiteSpace: 'nowrap' }}>{fs?.impact || '—'}</td>
                      <td style={{ padding: '8px 12px', color: '#6b6b68', whiteSpace: 'nowrap' }}>{f.fileDate}</td>
                      <td style={{ padding: '8px 12px', color: '#9b9b98', whiteSpace: 'nowrap' }}>{timeLabel}</td>
                      <td style={{ padding: '8px 12px', color: '#9b9b98' }}>{f.periodOfReport !== '—' ? f.periodOfReport : ''}</td>
                      <td style={{ padding: '8px 12px' }}>
                        {f.filingUrl && (
                          <a href={f.filingUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                            Открыть ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > VISIBLE_LIMIT && (
            <div style={{ textAlign: 'center', padding: '10px 0', fontSize: 12, color: '#9b9b98' }}>
              Показаны последние {VISIBLE_LIMIT} из {filtered.length}. Сузьте поиск или временной диапазон, чтобы увидеть остальные.
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#9b9b98', fontSize: 14 }}>
          {loading ? 'Loading filings...' : 'No filings found. Try expanding the time range or changing filters.'}
        </div>
      )}
    </div>
  )
}
