const colors: Record<string, { bg: string; color: string }> = {
  green:  { bg: 'var(--green-bg)',  color: 'var(--green)' },
  red:    { bg: 'var(--red-bg)',    color: 'var(--red)' },
  yellow: { bg: 'var(--yellow-bg)', color: 'var(--yellow)' },
  blue:   { bg: 'var(--accent-bg)', color: 'var(--accent)' },
  gray:   { bg: '#f1f1ef',          color: 'var(--text-2)' },
}

export default function Badge({ label, color = 'gray' }: { label: string; color?: string }) {
  const c = colors[color] || colors.gray
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px',
      borderRadius: 99, background: c.bg, color: c.color,
      whiteSpace: 'nowrap', display: 'inline-block'
    }}>{label}</span>
  )
}
