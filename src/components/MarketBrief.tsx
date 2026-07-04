'use client'
import { useState } from 'react'
import { useKeys } from '@/lib/keys'
import Markdown from './Markdown'
import { AI_SYSTEM_PROMPT, MARKET_PROMPTS } from '@/lib/prompts'

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e5e3', borderRadius: 12, padding: '1rem 1.25rem' }

export default function MarketBrief() {
  const { keys } = useKeys()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  async function run(id: string) {
    const def = MARKET_PROMPTS.find(p => p.id === id)
    if (!def) return
    if (!keys.anthropic) { setError('Добавьте Anthropic API ключ в панель ключей выше.'); return }
    setActiveId(id); setLoading(true); setError('')
    try {
      const res = await fetch('/api/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anthropicKey: keys.anthropic,
          system: AI_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: def.build() }],
          maxTokens: 3000,
        })
      })
      const d = await res.json()
      if (d.error) { setError(d.error) }
      else setResults(prev => ({ ...prev, [id]: d.text }))
    } catch (e: any) { setError(e.message || 'Network error') }
    setLoading(false)
  }

  return (
    <div>
      {!keys.anthropic && (
        <div style={{ background: '#fffbeb', color: '#92400e', padding: '10px 14px', borderRadius: 8, marginBottom: '1rem', fontSize: 13 }}>
          ⚠️ Добавьте Anthropic API ключ в панель ключей выше, чтобы использовать Market Brief.
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '1.5rem' }}>
        {MARKET_PROMPTS.map(p => (
          <button key={p.id} onClick={() => run(p.id)} disabled={loading}
            style={{
              background: activeId === p.id ? '#1a1a18' : '#fff',
              color: activeId === p.id ? '#fff' : '#1a1a18',
              border: '1px solid #e5e5e3', borderRadius: 8, padding: '8px 16px',
              fontSize: 13, cursor: 'pointer', fontWeight: activeId === p.id ? 600 : 400
            }}>
            {loading && activeId === p.id ? 'Генерирую...' : p.label}
          </button>
        ))}
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 14px', borderRadius: 8, marginBottom: '1rem', fontSize: 13 }}>{error}</div>}

      {activeId && (
        <div style={card}>
          {loading ? (
            <div style={{ fontSize: 13, color: '#9b9b98' }}>Генерирую отчёт...</div>
          ) : results[activeId] ? (
            <Markdown text={results[activeId]} />
          ) : (
            <div style={{ fontSize: 13, color: '#9b9b98' }}>Нажмите на кнопку выше, чтобы сгенерировать отчёт.</div>
          )}
        </div>
      )}
    </div>
  )
}
