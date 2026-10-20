'use client'

export type FailedBreakoutData = {
  failed_level: number
  reclaim_level: number
  short_observation: string
}

export default function FailedBreakout({ data }: { data: FailedBreakoutData }) {
  return (
    <div className="bg-red-950/40 border border-red-800 rounded-xl p-5">
      <h2 className="text-xs uppercase tracking-wide text-red-400 mb-3">Failed Breakout</h2>
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <div className="text-xs text-gray-500 mb-1">Failed level</div>
          <div className="text-lg font-semibold text-red-300">${data.failed_level}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Reclaim level (long reset)</div>
          <div className="text-lg font-semibold text-gray-200">${data.reclaim_level}</div>
        </div>
      </div>
      <p className="text-sm text-gray-300 leading-relaxed pt-3 border-t border-red-900/60">{data.short_observation}</p>
    </div>
  )
}
