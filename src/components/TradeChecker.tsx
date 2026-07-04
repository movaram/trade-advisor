'use client'
import { useState, useEffect, useRef } from 'react'
import { useKeys } from '@/lib/keys'
import Badge from './Badge'
import { detectCatalysts, catalystScore, fmt } from '@/lib/api'

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e5e3', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem' }
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #e5e5e3' }

function MetricBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#f8f8f7', border: '1px solid #e5e5e3', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: '#9b9b98', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: color || '#1a1a18' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9b9b98', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function pctColor(val: any) {
  const n = Number(val); if (isNaN(n)) return '#1a1a18'
  return n >= 0 ? '#16a34a' : '#dc2626'
}
function fmtPct(val: any) {
  if (val == null || isNaN(Number(val))) return 'N/A'
  const n = Number(val); return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'
}
function fmtM(val: any) {
  if (val == null || isNaN(Number(val))) return '—'
  const n = Number(val)
  if (Math.abs(n) >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B'
  if (Math.abs(n) >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M'
  return '$' + n.toFixed(0)
}

// TheFly-style news icons
function getNewsIcon(headline: string): { icon: string; color: string } {
  const h = headline.toLowerCase()
  if (h.includes('upgrade') || h.includes('outperform') || h.includes('overweight')) return { icon: '⬆', color: '#16a34a' }
  if (h.includes('downgrade') || h.includes('underperform') || h.includes('underweight')) return { icon: '⬇', color: '#dc2626' }
  if (h.includes('target') && (h.includes('raises') || h.includes('increase') || h.includes('up to'))) return { icon: '🎯↑', color: '#16a34a' }
  if (h.includes('target') && (h.includes('cut') || h.includes('lower') || h.includes('reduces'))) return { icon: '🎯↓', color: '#dc2626' }
  if (h.includes('beat') || h.includes('tops') || h.includes('surpass')) return { icon: '✓', color: '#16a34a' }
  if (h.includes('miss') || h.includes('below') || h.includes('disappoint')) return { icon: '✗', color: '#dc2626' }
  if (h.includes('earn') || h.includes('eps') || h.includes('quarter')) return { icon: '$', color: '#d97706' }
  if (h.includes('guidance') || h.includes('outlook') || h.includes('forecast')) return { icon: '📋', color: '#6b6b68' }
  if (h.includes('fda') || h.includes('drug') || h.includes('trial') || h.includes('approval')) return { icon: '💊', color: '#7c3aed' }
  if (h.includes('merger') || h.includes('acqui') || h.includes('deal') || h.includes('buyout')) return { icon: '🤝', color: '#2563eb' }
  if (h.includes('dividend') || h.includes('buyback') || h.includes('repurchase')) return { icon: '💰', color: '#16a34a' }
  if (h.includes('halt') || h.includes('suspend')) return { icon: '⏸', color: '#dc2626' }
  if (h.includes('initiat') || h.includes('coverage') || h.includes('begins')) return { icon: '◆', color: '#6b6b68' }
  return { icon: '•', color: '#9b9b98' }
}

export default function TradeChecker({ initialTicker = '' }: { initialTicker?: string }) {
  const { keys } = useKeys()
  const [ticker, setTicker] = useState(initialTicker)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [aiAnalysis, setAiAnalysis] = useState<any>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [financials, setFinancials] = useState<any>(null)
  const [finPeriod, setFinPeriod] = useState<'Q' | 'A'>('Q')
  const [history, setHistory] = useState<any[]>([])
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<any>(null)

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem('ta_history') || '[]')) } catch {}
  }, [])

  function saveToHistory(t: string, data: any) {
    try {
      const h = JSON.parse(localStorage.getItem('ta_history') || '[]')
      const filtered = h.filter((x: any) => x.ticker !== t)
      const newHistory = [{ ticker: t, company: data.profile?.name || t, timestamp: Date.now() }, ...filtered].slice(0, 50)
      localStorage.setItem('ta_history', JSON.stringify(newHistory))
      setHistory(newHistory)
      const c = JSON.parse(localStorage.getItem('ta_cache') || '{}')
      const keys2 = Object.keys(c)
      if (keys2.length >= 20) delete c[keys2.sort((a,b) => c[a].ts - c[b].ts)[0]]
      c[t] = { data, ts: Date.now() }
      localStorage.setItem('ta_cache', JSON.stringify(c))
    } catch {}
  }

  function loadFromCache(t: string) {
    try {
      const c = JSON.parse(localStorage.getItem('ta_cache') || '{}')
      const entry = c[t]
      if (entry && Date.now() - entry.ts < 30*60*1000) return entry.data
    } catch {}
    return null
  }

  async function analyze(t?: string) {
    const sym = (t || ticker).trim().toUpperCase()
    if (!sym) return
    if (!keys.finnhub) { setError('Please save your Finnhub API key above.'); return }
    setTicker(sym); setError(''); setAiAnalysis(null); setChatMessages([])

    const cached = loadFromCache(sym)
    if (cached) {
      const catalysts = detectCatalysts(cached.filings, cached.insiders, cached.news, cached.sentiment, cached.recs)
      const score = catalystScore(catalysts)
      setResult({ ...cached, catalysts, score, ticker: sym })
      loadFinancials(sym)
      generateAiAnalysis(sym, cached)
      return
    }

    setLoading(true); setResult(null); setFinancials(null)
    try {
      const data = await fetch('/api/full-analysis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: sym, finnhubKey: keys.finnhub, fmpKey: keys.fmp })
      }).then(r => r.json())
      if (data.error) throw new Error(data.error)
      const catalysts = detectCatalysts(data.filings, data.insiders, data.news, data.sentiment, data.recs)
      const score = catalystScore(catalysts)
      setResult({ ...data, catalysts, score, ticker: sym })
      saveToHistory(sym, data)
      loadFinancials(sym)
      generateAiAnalysis(sym, data)
    } catch (e: any) { setError('Error: ' + e.message) }
    setLoading(false)
  }

  async function loadFinancials(sym: string) {
    if (!keys.fmp) return
    try {
      const data = await fetch('/api/financials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: sym, fmpKey: keys.fmp })
      }).then(r => r.json())
      setFinancials(data)
    } catch {}
  }

  async function generateAiAnalysis(sym: string, data: any) {
    setAiLoading(true)
    try {
      const prompt = `Stock analyst for ${sym}. Be concise. Respond ONLY with JSON:
{"bull_case_ru":"2 sentences bull case in Russian","bear_case_ru":"2 sentences bear case in Russian","description_ru":"2 sentences: what company does + main products in Russian"}
Data: ${data.profile?.name}, ${data.profile?.finnhubIndustry}, News: ${(data.news||[]).slice(0,3).map((n:any)=>n.headline).join(' | ')}`

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
      })
      const d = await r.json()
      const text = d.content?.[0]?.text || '{}'
      setAiAnalysis(JSON.parse(text.replace(/```json|```/g, '').trim()))
    } catch {}
    setAiLoading(false)
  }

  async function sendChat() {
    if (!chatInput.trim() || !result) return
    const userMsg = chatInput.trim(); setChatInput('')
    const newMessages = [...chatMessages, { role: 'user', content: userMsg }]
    setChatMessages(newMessages); setChatLoading(true)
    try {
      const context = `Stock: ${result.ticker} (${result.profile?.name}), Industry: ${result.profile?.finnhubIndustry}, PE: ${result.metrics?.peNormalizedAnnual || 'N/A'}, EPS: ${result.metrics?.epsNormalizedAnnual || 'N/A'}, Net Margin: ${result.metrics?.netProfitMarginTTM || 'N/A'}%, News: ${(result.news||[]).slice(0,3).map((n:any)=>n.headline).join(' | ')}`
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 800,
          system: `You are a professional swing trading analyst. Answer questions about stocks concisely in Russian. Context: ${context}`,
          messages: newMessages.map(m => ({ role: m.role, content: m.content }))
        })
      })
      const d = await r.json()
      const reply = d.content?.[0]?.text || 'Не удалось получить ответ'
      setChatMessages([...newMessages, { role: 'assistant', content: reply }])
    } catch { setChatMessages([...newMessages, { role: 'assistant', content: 'Ошибка запроса' }]) }
    setChatLoading(false)
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  const r = result
  const incomeData = financials ? (finPeriod === 'Q' ? financials.quarterlyIncome : financials.annualIncome) : []
  const estimates = financials ? (finPeriod === 'Q' ? financials.quarterlyEstimates : financials.annualEstimates) : []

  return (
    <div style={{ display: 'flex', gap: 0 }}>
      {/* History sidebar */}
      <div style={{ width: 130, flexShrink: 0, marginRight: 20 }}>
        {history.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: '#9b9b98', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>History</span>
              <button onClick={() => { localStorage.removeItem('ta_history'); localStorage.removeItem('ta_cache'); setHistory([]) }} style={{ fontSize: 10, color: '#9b9b98', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Clear</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {history.slice(0,20).map((h: any) => (
                <button key={h.ticker} onClick={() => analyze(h.ticker)} style={{
                  background: r?.ticker === h.ticker ? '#1a1a18' : '#fff',
                  color: r?.ticker === h.ticker ? '#fff' : '#1a1a18',
                  border: '1px solid #e5e5e3', borderRadius: 8, padding: '6px 10px',
                  fontSize: 12, cursor: 'pointer', textAlign: 'left'
                }}>
                  <div style={{ fontWeight: 600 }}>{h.ticker}</div>
                  {h.company && <div style={{ fontSize: 10, color: r?.ticker === h.ticker ? '#ccc' : '#9b9b98', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{h.company.split(' ').slice(0,2).join(' ')}</div>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Main */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: '1.5rem', alignItems: 'center' }}>
          <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && analyze()}
            placeholder="Ticker e.g. NVDA" style={{ fontSize: 16, fontWeight: 500, maxWidth: 180 }} />
          <button onClick={() => analyze()} disabled={loading}
            style={{ background: '#1a1a18', color: '#fff', padding: '0 20px', height: 38, borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>
            {loading ? 'Analyzing...' : 'Analyze →'}
          </button>
        </div>

        {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 14px', borderRadius: 8, marginBottom: '1rem', fontSize: 13 }}>{error}</div>}

        {r && <>
          {/* Header */}
          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {r.profile?.name || r.ticker}
                <span style={{ color: '#9b9b98', fontWeight: 400, fontSize: 14, marginLeft: 8 }}>{r.ticker}</span>
              </div>
              <div style={{ fontSize: 13, color: '#6b6b68', marginTop: 2 }}>
                {r.profile?.exchange} · {r.profile?.finnhubIndustry}
                {r.companyProfile?.mktCap && ` · Mcap $${(r.companyProfile.mktCap/1e9).toFixed(1)}B`}
              </div>
            </div>
            {r.priceRange?.currentPrice && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>${Number(r.priceRange.currentPrice).toFixed(2)}</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                  {r.priceRange.high52Pct && <span style={{ fontSize: 12, color: pctColor(r.priceRange.high52Pct) }}>{fmtPct(r.priceRange.high52Pct)} vs 52W High</span>}
                  {r.priceRange.low52Pct && <span style={{ fontSize: 12, color: pctColor(r.priceRange.low52Pct) }}>{fmtPct(r.priceRange.low52Pct)} vs 52W Low</span>}
                </div>
              </div>
            )}
          </div>

          {/* AI Description */}
          {(aiLoading || aiAnalysis?.description_ru) && (
            <div style={{ ...card, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: '#2563eb', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>🤖 О компании</div>
              <div style={{ fontSize: 14, lineHeight: 1.7 }}>{aiLoading && !aiAnalysis ? 'Генерирую...' : aiAnalysis?.description_ru}</div>
            </div>
          )}

          {/* Catalysts */}
          {r.catalysts?.length > 0 && (
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontWeight: 500 }}>⚡ Catalysts</span>
                <Badge label={r.score.label} color={r.score.color} />
              </div>
              {r.catalysts.map((c: any, i: number) => (
                <div key={i} style={{ ...rowStyle, borderBottom: i === r.catalysts.length-1 ? 'none' : '1px solid #e5e5e3' }}>
                  <span style={{ fontSize: 16 }}>{c.icon}</span>
                  <span style={{ flex: 1, fontSize: 13 }}>{c.text}</span>
                  <Badge label={c.type} color={c.type==='bullish'?'green':c.type==='bearish'?'red':c.type==='filing'?'blue':'gray'} />
                </div>
              ))}
            </div>
          )}

          {/* Price & RS */}
          <div style={card}>
            <div style={{ fontWeight: 500, marginBottom: 12 }}>📈 Price & Relative Strength</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }}>
              <MetricBox label="52W High" value={r.priceRange?.week52High ? `$${Number(r.priceRange.week52High).toFixed(2)}` : 'N/A'}
                sub={r.priceRange?.high52Pct ? `${fmtPct(r.priceRange.high52Pct)} from high` : undefined}
                color={r.priceRange?.high52Pct ? pctColor(r.priceRange.high52Pct) : undefined} />
              <MetricBox label="52W Low" value={r.priceRange?.week52Low ? `$${Number(r.priceRange.week52Low).toFixed(2)}` : 'N/A'}
                sub={r.priceRange?.low52Pct ? `${fmtPct(r.priceRange.low52Pct)} from low` : undefined} color="#16a34a" />
              <MetricBox label="1 Month RS" value={fmtPct(r.rs?.month1)} color={pctColor(r.rs?.month1)} />
              <MetricBox label="3 Month RS" value={fmtPct(r.rs?.month3)} color={pctColor(r.rs?.month3)} />
              <MetricBox label="YTD RS" value={fmtPct(r.rs?.ytd)} color={pctColor(r.rs?.ytd)} />
              <MetricBox label="Beta" value={fmt(r.metrics?.beta,'','',2)} />
            </div>
          </div>

          {/* Fundamentals */}
          <div style={card}>
            <div style={{ fontWeight: 500, marginBottom: 12 }}>📊 Fundamentals (TTM)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
              <MetricBox label="P/E ratio" value={fmt(r.metrics?.['peNormalizedAnnual']||r.metrics?.['peTTM'],'','',1)} />
              <MetricBox label="EPS (TTM)" value={fmt(r.metrics?.epsNormalizedAnnual,'$','',2)} />
              <MetricBox label="ROE" value={fmt(r.metrics?.roeTTM,'','%',1)} />
              <MetricBox label="Net margin" value={fmt(r.metrics?.netProfitMarginTTM,'','%',1)} />
              <MetricBox label="Rev growth YoY" value={fmtPct(r.metrics?.revenueGrowthTTMYoy)} color={pctColor(r.metrics?.revenueGrowthTTMYoy)} />
              <MetricBox label="Gross margin" value={fmt(r.metrics?.grossMarginTTM,'','%',1)} />
              <MetricBox label="P/S ratio" value={fmt(r.metrics?.psTTM,'','',2)} />
              <MetricBox label="Debt/equity" value={fmt(r.metrics?.['totalDebt/totalEquityAnnual'],'','',2)} />
              <MetricBox label="Short ratio" value={fmt(r.metrics?.shortRatio,'','d',1)} />
              <MetricBox label="Shares out" value={r.companyProfile?.sharesOutstanding ? `${(r.companyProfile.sharesOutstanding/1e6).toFixed(0)}M` : 'N/A'} />
            </div>
          </div>

          {/* Revenue & Earnings */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontWeight: 500 }}>💰 Revenue & Earnings History</span>
              <div style={{ display: 'flex', border: '1px solid #e5e5e3', borderRadius: 8, overflow: 'hidden' }}>
                {(['Q','A'] as const).map(p => (
                  <button key={p} onClick={() => setFinPeriod(p)} style={{
                    padding: '4px 14px', fontSize: 12, border: 'none', cursor: 'pointer',
                    background: finPeriod===p ? '#1a1a18' : '#fff',
                    color: finPeriod===p ? '#fff' : '#6b6b68', fontWeight: finPeriod===p ? 600 : 400
                  }}>{p==='Q'?'Quarterly':'Annual'}</button>
                ))}
              </div>
            </div>
            {incomeData.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e5e5e3' }}>
                      {['Period','Revenue','Rev YoY','Gross Profit','Net Income','EPS','Margin'].map(h => (
                        <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: '#9b9b98', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {incomeData.map((row: any, i: number) => {
                      const prev = incomeData[i+1]
                      const revG = prev?.revenue ? ((row.revenue-prev.revenue)/Math.abs(prev.revenue)*100) : null
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #e5e5e3' }}>
                          <td style={{ padding: '7px 10px', fontWeight: 500, whiteSpace: 'nowrap' }}>{row.date?.substring(0,7)}</td>
                          <td style={{ padding: '7px 10px', fontWeight: 500 }}>{fmtM(row.revenue)}</td>
                          <td style={{ padding: '7px 10px', color: revG!=null?pctColor(revG):'#9b9b98', fontWeight: 500 }}>{revG!=null?fmtPct(revG):'—'}</td>
                          <td style={{ padding: '7px 10px', color: '#6b6b68' }}>{fmtM(row.grossProfit)}</td>
                          <td style={{ padding: '7px 10px', color: (row.netIncome||0)>=0?'#16a34a':'#dc2626', fontWeight: 500 }}>{fmtM(row.netIncome)}</td>
                          <td style={{ padding: '7px 10px', fontWeight: 500 }}>{row.eps!=null?`$${Number(row.eps).toFixed(2)}`:'—'}</td>
                          <td style={{ padding: '7px 10px', color: '#6b6b68' }}>{row.netIncomeRatio!=null?(row.netIncomeRatio*100).toFixed(1)+'%':'—'}</td>
                        </tr>
                      )
                    })}
                    {estimates.slice(0,3).map((est: any, i: number) => (
                      <tr key={`e${i}`} style={{ background: '#f8f8f7', borderBottom: '1px solid #e5e5e3', opacity: 0.8 }}>
                        <td style={{ padding: '7px 10px', color: '#6b6b68' }}>{est.date?.substring(0,7)} <span style={{ fontSize:10, background:'#e5e5e3', borderRadius:3, padding:'1px 4px' }}>est</span></td>
                        <td style={{ padding: '7px 10px', color: '#6b6b68' }}>{fmtM(est.estimatedRevenueAvg)}</td>
                        <td colSpan={3} style={{ padding: '7px 10px', color: '#9b9b98' }}>—</td>
                        <td style={{ padding: '7px 10px', color: '#6b6b68' }}>{est.estimatedEpsAvg!=null?`$${Number(est.estimatedEpsAvg).toFixed(2)}`:'—'}</td>
                        <td style={{ padding: '7px 10px', color: '#9b9b98' }}>—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#9b9b98', padding: '8px 0' }}>
                {keys.fmp ? (financials === null ? 'Loading...' : 'No financial data available') : '⚠️ Add FMP API key to see revenue & earnings history'}
              </div>
            )}
          </div>

          {/* Earnings Surprise */}
          {r.earningsSurprise?.length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 500, marginBottom: 12 }}>📊 Earnings Surprise</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ borderBottom: '1px solid #e5e5e3' }}>
                    {['Date','Actual EPS','Estimate','Surprise','Surprise %'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: '#9b9b98', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {r.earningsSurprise.slice(0,6).map((e: any, i: number) => {
                      const actual = e.actualEarningResult ?? e.actual
                      const est = e.estimatedEarning ?? e.estimate
                      const surprise = actual!=null&&est!=null ? actual-est : null
                      const surprisePct = surprise!=null&&est ? (surprise/Math.abs(est)*100) : null
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #e5e5e3' }}>
                          <td style={{ padding: '7px 10px', color: '#6b6b68' }}>{e.date||e.period}</td>
                          <td style={{ padding: '7px 10px', fontWeight: 500 }}>{actual!=null?`$${Number(actual).toFixed(2)}`:'N/A'}</td>
                          <td style={{ padding: '7px 10px', color: '#6b6b68' }}>{est!=null?`$${Number(est).toFixed(2)}`:'N/A'}</td>
                          <td style={{ padding: '7px 10px', color: surprise!=null?pctColor(surprise):'#1a1a18', fontWeight: 500 }}>{surprise!=null?(surprise>=0?'+':'')+surprise.toFixed(2):'N/A'}</td>
                          <td style={{ padding: '7px 10px', fontWeight: 700, color: surprisePct!=null?pctColor(surprisePct):'#1a1a18' }}>{surprisePct!=null?fmtPct(surprisePct):'N/A'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Analyst Ratings */}
          <div style={card}>
            <div style={{ fontWeight: 500, marginBottom: 12 }}>🎯 Analyst Ratings & Price Targets</div>
            {r.recs?.[0] && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 12 }}>
                <MetricBox label="Strong Buy" value={String(r.recs[0].strongBuy)} color="#16a34a" />
                <MetricBox label="Buy" value={String(r.recs[0].buy)} color="#16a34a" />
                <MetricBox label="Hold" value={String(r.recs[0].hold)} color="#d97706" />
                <MetricBox label="Sell" value={String(r.recs[0].sell)} color="#dc2626" />
                <MetricBox label="Strong Sell" value={String(r.recs[0].strongSell)} color="#dc2626" />
              </div>
            )}
            {r.priceTarget && (r.priceTarget.targetMean || r.priceTarget.targetHigh) && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
                <MetricBox label="PT High" value={r.priceTarget.targetHigh?`$${r.priceTarget.targetHigh}`:'N/A'} color="#16a34a" />
                <MetricBox label="PT Mean" value={r.priceTarget.targetMean?`$${Number(r.priceTarget.targetMean).toFixed(2)}`:'N/A'} />
                <MetricBox label="PT Low" value={r.priceTarget.targetLow?`$${r.priceTarget.targetLow}`:'N/A'} color="#dc2626" />
              </div>
            )}
            {r.recentGrades?.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: '#6b6b68' }}>Recent changes (30d):</span>
                  {r.recentGrades.length >= 5 && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: '#fffbeb', color: '#d97706' }}>⚠️ {r.recentGrades.length} analysts changed target</span>}
                </div>
                {r.recentGrades.slice(0,8).map((g: any, i: number) => (
                  <div key={i} style={{ ...rowStyle, fontSize: 12, borderBottom: i<Math.min(r.recentGrades.length,8)-1?'1px solid #e5e5e3':'none' }}>
                    <span style={{ color: '#9b9b98', minWidth: 85 }}>{g.date}</span>
                    <span style={{ flex: 1 }}>{g.gradingCompany}</span>
                    <span style={{ color: '#9b9b98' }}>{g.previousGrade} →</span>
                    <span style={{ fontWeight: 600, color: g.newGrade?.toLowerCase().includes('buy')||g.newGrade?.toLowerCase().includes('outperform')?'#16a34a':g.newGrade?.toLowerCase().includes('sell')||g.newGrade?.toLowerCase().includes('underperform')?'#dc2626':'#1a1a18' }}>{g.newGrade}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Insiders */}
          {r.insiders?.length > 0 && (
            <div style={card}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontWeight: 500 }}>👥 Insider Transactions</span>
                <Badge label={r.insiders.filter((i:any)=>i.transactionType==='P').length>r.insiders.filter((i:any)=>i.transactionType==='S').length?'Net buying':'Net selling'}
                  color={r.insiders.filter((i:any)=>i.transactionType==='P').length>r.insiders.filter((i:any)=>i.transactionType==='S').length?'green':'red'} />
              </div>
              {r.insiders.slice(0,6).map((ins: any, i: number) => (
                <div key={i} style={{ ...rowStyle, fontSize: 13, borderBottom: i===5?'none':'1px solid #e5e5e3' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: ins.transactionType==='P'?'#f0fdf4':'#fef2f2', color: ins.transactionType==='P'?'#16a34a':'#dc2626' }}>{ins.transactionType==='P'?'Buy':'Sell'}</span>
                  <span style={{ flex: 1 }}>{ins.name||'Insider'}</span>
                  <span style={{ color: '#6b6b68', fontSize: 12 }}>{ins.share?Number(ins.share).toLocaleString()+' sh':''}</span>
                  <span style={{ color: '#9b9b98', fontSize: 11 }}>{ins.transactionDate||''}</span>
                </div>
              ))}
            </div>
          )}

          {/* Institutional */}
          {r.institutionalOwnership?.length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 500, marginBottom: 10 }}>🏦 Institutional Ownership (Top holders)</div>
              {r.institutionalOwnership.slice(0,6).map((inst: any, i: number) => (
                <div key={i} style={{ ...rowStyle, fontSize: 13, borderBottom: i===5?'none':'1px solid #e5e5e3' }}>
                  <span style={{ flex: 1 }}>{inst.holder}</span>
                  <span style={{ color: '#6b6b68', fontSize: 12 }}>{inst.shares?Number(inst.shares).toLocaleString()+' sh':''}</span>
                  <span style={{ fontSize: 13, color: (inst.change||0)>0?'#16a34a':(inst.change||0)<0?'#dc2626':'#9b9b98', fontWeight: 600 }}>
                    {(inst.change||0)>0?'▲':(inst.change||0)<0?'▼':'—'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* News - TheFly style */}
          {r.news?.length > 0 && (
            <div style={card}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 500 }}>News</span>
                {r.sentiment?.sentiment?.bullishPercent!=null && (
                  <Badge label={r.sentiment.sentiment.bullishPercent>0.6?'Bullish':r.sentiment.sentiment.bullishPercent<0.4?'Bearish':'Neutral'}
                    color={r.sentiment.sentiment.bullishPercent>0.6?'green':r.sentiment.sentiment.bullishPercent<0.4?'red':'yellow'} />
                )}
                {r.sentiment?.buzz?.articlesInLastWeek && <span style={{ fontSize: 12, color: '#9b9b98' }}>{r.sentiment.buzz.articlesInLastWeek}/wk</span>}
              </div>
              {r.news.slice(0,12).map((n: any, i: number) => {
                const ni = getNewsIcon(n.headline)
                return (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: i===11?'none':'1px solid #f1f1ef', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: ni.color, minWidth: 22, textAlign: 'center', lineHeight: 1.5, flexShrink: 0 }}>{ni.icon}</span>
                    <div style={{ flex: 1 }}>
                      <a href={n.url} target="_blank" rel="noopener noreferrer" style={{ color: '#1a1a18', fontSize: 13, textDecoration: 'none' }}>{n.headline}</a>
                      <div style={{ fontSize: 11, color: '#9b9b98', marginTop: 1 }}>{n.source} · {new Date(n.datetime*1000).toLocaleDateString()}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* SEC Filings */}
          {r.filings?.length > 0 && (
            <div style={card}>
              <div style={{ fontWeight: 500, marginBottom: 10 }}>📁 SEC Filings</div>
              {r.filings.slice(0,6).map((f: any, i: number) => {
                const s = f._source || {}
                return (
                  <div key={i} style={{ ...rowStyle, borderBottom: i===Math.min(r.filings.length,6)-1?'none':'1px solid #e5e5e3' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: '#eff6ff', color: '#2563eb', whiteSpace: 'nowrap' }}>{s.form_type||'?'}</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{s.entity_name||r.ticker}</span>
                    <span style={{ fontSize: 12, color: '#6b6b68' }}>{s.file_date||''}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Bull vs Bear */}
          {(aiLoading || aiAnalysis) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: '1rem' }}>
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, padding: '1rem' }}>
                <div style={{ fontWeight: 600, color: '#16a34a', marginBottom: 8, fontSize: 13 }}>🟢 Bull case</div>
                <div style={{ fontSize: 13, lineHeight: 1.7 }}>{aiLoading&&!aiAnalysis?.bull_case_ru?'Генерирую...':aiAnalysis?.bull_case_ru}</div>
              </div>
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 12, padding: '1rem' }}>
                <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 8, fontSize: 13 }}>🔴 Bear case</div>
                <div style={{ fontSize: 13, lineHeight: 1.7 }}>{aiLoading&&!aiAnalysis?.bear_case_ru?'Генерирую...':aiAnalysis?.bear_case_ru}</div>
              </div>
            </div>
          )}

          {/* AI Chat */}
          <div style={{ ...card, marginBottom: 0 }}>
            <div style={{ fontWeight: 500, marginBottom: 10, fontSize: 13 }}>💬 Ask AI about {r.ticker}</div>
            {chatMessages.length > 0 && (
              <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 10, padding: '8px 0' }}>
                {chatMessages.map((m, i) => (
                  <div key={i} style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', alignItems: m.role==='user'?'flex-end':'flex-start' }}>
                    <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: 10, background: m.role==='user'?'#1a1a18':'#f1f5f9', color: m.role==='user'?'#fff':'#1a1a18', fontSize: 13, lineHeight: 1.6 }}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatLoading && <div style={{ fontSize: 13, color: '#9b9b98', fontStyle: 'italic' }}>Анализирую...</div>}
                <div ref={chatEndRef} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key==='Enter' && !e.shiftKey && sendChat()}
                placeholder="Задай вопрос о компании или сделке..." style={{ flex: 1, fontSize: 13 }} />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                style={{ background: '#1a1a18', color: '#fff', padding: '0 16px', height: 38, borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>
                Send
              </button>
            </div>
          </div>
        </>}
      </div>
    </div>
  )
}
