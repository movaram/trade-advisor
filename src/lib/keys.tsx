'use client'
import { createContext, useContext, useState, ReactNode } from 'react'

interface Keys { massive: string; finnhub: string; fmp: string; anthropic: string }
const KeysCtx = createContext<{ keys: Keys; setKeys: (k: Keys) => void }>({
  keys: { massive: '', finnhub: '', fmp: '', anthropic: '' },
  setKeys: () => {}
})

export function KeysProvider({ children }: { children: ReactNode }) {
  const [keys, setKeys] = useState<Keys>({ massive: '', finnhub: '', fmp: '', anthropic: '' })
  return <KeysCtx.Provider value={{ keys, setKeys }}>{children}</KeysCtx.Provider>
}

export function useKeys() { return useContext(KeysCtx) }
