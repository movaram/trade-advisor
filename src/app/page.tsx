'use client'
import { useState } from 'react'
import { KeysProvider } from '@/lib/keys'
import KeysPanel from '@/components/KeysPanel'
import TradeChecker from '@/components/TradeChecker'
import CatalystScanner from '@/components/CatalystScanner'
import SecLive from '@/components/SecLive'
import EarningsCalendar from '@/components/EarningsCalendar'

const TABS = ['Trade checker', 'Catalyst scanner', 'SEC live', 'Earnings calendar']

export default function Home() {
  const [tab, setTab] = useState(0)
  const [deepTicker, setDeepTicker] = useState('')

  function handleDeepDive(ticker: string) {
    setDeepTicker(ticker)
    setTab(0)
  }

  return (
    <KeysProvider>
      <main style={{ minHeight: '100vh', padding: '1.5rem 2rem' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: 16 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 2 }}>Trade Advisor</h1>
              <p style={{ fontSize: 12, color: 'var(--text-3)' }}>Swing trading research — fundamentals, filings, news, catalyst scanner</p>
            </div>
          </div>

          <KeysPanel />

          <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', overflowX: 'auto' }}>
            {TABS.map((t, i) => (
              <button key={t} onClick={() => setTab(i)} style={{
                padding: '8px 18px', fontSize: 14, background: 'none',
                color: tab === i ? 'var(--text)' : 'var(--text-2)',
                borderBottom: tab === i ? '2px solid var(--text)' : '2px solid transparent',
                borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                marginBottom: -1, fontWeight: tab === i ? 500 : 400,
                cursor: 'pointer', whiteSpace: 'nowrap'
              }}>{t}</button>
            ))}
          </div>

          {tab === 0 && <TradeChecker initialTicker={deepTicker} />}
          {tab === 1 && <CatalystScanner onDeepDive={handleDeepDive} />}
          {tab === 2 && <SecLive />}
          {tab === 3 && <EarningsCalendar />}
        </div>
      </main>
    </KeysProvider>
  )
}
