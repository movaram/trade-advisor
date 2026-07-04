import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Trade Advisor',
  description: 'Swing trading research tool — fundamentals, filings, catalysts',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
