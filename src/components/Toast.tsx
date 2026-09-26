'use client'
import { useEffect } from 'react'

export default function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="fixed bottom-6 right-6 bg-green-950 border border-green-600 text-green-300 text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg z-50">
      {message}
    </div>
  )
}
