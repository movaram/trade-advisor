'use client'

export type MomentumChecklistData = {
  m1_impulse: boolean; m1_explanation: string
  m2_consolidation: boolean; m2_explanation: string
  m3_tightening: boolean; m3_explanation: string
  m4_breakout_day: boolean; m4_explanation: string
  m5_leadership: boolean; m5_explanation: string
}

function Row({ label, pass, explanation }: { label: string; pass: boolean; explanation: string }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-800 last:border-0">
      <span className="text-lg leading-none mt-0.5">{pass ? '✅' : '❌'}</span>
      <div>
        <div className="text-sm font-medium text-gray-200">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{explanation}</div>
      </div>
    </div>
  )
}

export default function MomentumChecklist({ checklist }: { checklist: MomentumChecklistData }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5">
      <h2 className="text-xs uppercase tracking-wide text-gray-500 mb-1">Momentum Checklist</h2>
      <Row label="M1: Prior impulse 30%+" pass={checklist.m1_impulse} explanation={checklist.m1_explanation} />
      <Row label="M2: Orderly consolidation" pass={checklist.m2_consolidation} explanation={checklist.m2_explanation} />
      <Row label="M3: Tightening before breakout" pass={checklist.m3_tightening} explanation={checklist.m3_explanation} />
      <Row label="M4: Quality breakout day" pass={checklist.m4_breakout_day} explanation={checklist.m4_explanation} />
      <Row label="M5: Group/theme leadership" pass={checklist.m5_leadership} explanation={checklist.m5_explanation} />
    </div>
  )
}
