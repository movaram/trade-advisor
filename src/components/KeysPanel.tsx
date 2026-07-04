'use client'
import { useState } from 'react'
import { useKeys } from '@/lib/keys'

export default function KeysPanel() {
  const { keys, setKeys } = useKeys()
  const [massive, setMassive] = useState(keys.massive)
  const [finnhub, setFinnhub] = useState(keys.finnhub)
  const [fmp, setFmp] = useState(keys.fmp || '')
  const [anthropic, setAnthropic] = useState(keys.anthropic || '')
  const [saved, setSaved] = useState(false)

  function save() {
    setKeys({ massive, finnhub, fmp, anthropic })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>API Keys</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Massive / Polygon</div>
          <input type="password" value={massive} onChange={e => setMassive(e.target.value)} placeholder="Paste key..." />
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Finnhub</div>
          <input type="password" value={finnhub} onChange={e => setFinnhub(e.target.value)} placeholder="Paste key..." />
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>FMP (Financial Modeling Prep)</div>
          <input type="password" value={fmp} onChange={e => setFmp(e.target.value)} placeholder="Paste key..." />
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Anthropic (AI chat)</div>
          <input type="password" value={anthropic} onChange={e => setAnthropic(e.target.value)} placeholder="Paste key..." />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={save} style={{ background: 'var(--text)', color: '#fff', padding: '6px 18px', fontSize: 13 }}>
          {saved ? 'Saved ✓' : 'Save keys'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Keys stay in your browser only — never stored anywhere.</span>
      </div>
    </div>
  )
}
