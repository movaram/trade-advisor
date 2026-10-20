'use client'

export type ActionPlanData = {
  trigger: string
  stop: string
  invalidation: string
  management: string
  skip_conditions: string | null
  size: string
}

const sizeColor: Record<string, string> = {
  '1R': 'text-green-400',
  '0.75R': 'text-green-400',
  '0.5R': 'text-yellow-400',
  '0.375R': 'text-yellow-400',
  '0.25R': 'text-yellow-400',
  '0': 'text-red-400',
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-800 last:border-0">
      <span className="text-xs uppercase tracking-wide text-gray-500 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-200 text-right">{value}</span>
    </div>
  )
}

export default function ActionPlan({
  plan,
  isSkip,
}: {
  plan: ActionPlanData
  isSkip: boolean
}) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
      <h2 className="text-xs uppercase tracking-wide text-gray-500 mb-3">📋 Action Plan</h2>
      {isSkip ? (
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Что нужно, чтобы вернуться к сделке</div>
          <p className="text-sm text-gray-300 leading-relaxed">{plan.skip_conditions || '—'}</p>
        </div>
      ) : (
        <>
          <Row label="Trigger" value={plan.trigger} />
          <Row label="Stop" value={plan.stop} />
          <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-800">
            <span className="text-xs uppercase tracking-wide text-gray-500 shrink-0 pt-0.5">Size</span>
            <span className={`text-sm font-bold ${sizeColor[plan.size] || 'text-gray-300'}`}>{plan.size}</span>
          </div>
          <Row label="Invalidation" value={plan.invalidation} />
          <Row label="Management" value={plan.management} />
        </>
      )}
    </div>
  )
}
