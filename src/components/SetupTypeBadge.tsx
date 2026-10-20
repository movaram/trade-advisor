'use client'

export type SetupType = 'EP' | 'MOMENTUM' | 'DEP' | 'FAILED_BREAKOUT'

const setupStyles: Record<SetupType, { bg: string; border: string; text: string; label: string }> = {
  EP: { bg: 'bg-blue-950', border: 'border-blue-600', text: 'text-blue-300', label: 'EP' },
  MOMENTUM: { bg: 'bg-purple-950', border: 'border-purple-600', text: 'text-purple-300', label: 'MOMENTUM' },
  DEP: { bg: 'bg-orange-950', border: 'border-orange-600', text: 'text-orange-300', label: 'DEP' },
  FAILED_BREAKOUT: { bg: 'bg-red-950', border: 'border-red-600', text: 'text-red-300', label: 'FAILED BO' },
}

export default function SetupTypeBadge({
  setupType,
  explanation,
}: {
  setupType: SetupType
  explanation: string
}) {
  const s = setupStyles[setupType] || setupStyles.EP
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
      <h2 className="text-xs uppercase tracking-wide text-gray-500 mb-3">Setup Type</h2>
      <span className={`inline-block ${s.bg} border ${s.border} ${s.text} text-sm font-bold px-3 py-1 rounded-full mb-3`}>
        {s.label}
      </span>
      <p className="text-sm text-gray-300 leading-relaxed">{explanation}</p>
    </div>
  )
}
