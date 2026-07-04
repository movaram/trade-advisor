// Minimal markdown renderer for AI responses: headings, bullet/numbered lists, tables, bold text.

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={`${keyPrefix}-${i}`}>{p.slice(2, -2)}</strong>
    }
    return <span key={`${keyPrefix}-${i}`}>{p}</span>
  })
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: React.ReactNode[] = []
  let listBuffer: { ordered: boolean; items: string[] } | null = null
  let tableBuffer: string[][] | null = null

  function flushList(key: string) {
    if (!listBuffer) return
    const Tag = listBuffer.ordered ? 'ol' : 'ul'
    blocks.push(
      <Tag key={key} style={{ margin: '4px 0 10px', paddingLeft: 20 }}>
        {listBuffer.items.map((item, i) => (
          <li key={i} style={{ marginBottom: 4, lineHeight: 1.6 }}>{inline(item, `${key}-${i}`)}</li>
        ))}
      </Tag>
    )
    listBuffer = null
  }

  function flushTable(key: string) {
    if (!tableBuffer || tableBuffer.length === 0) return
    const [header, ...rows] = tableBuffer
    blocks.push(
      <div key={key} style={{ overflowX: 'auto', margin: '8px 0 12px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {header.map((h, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ padding: '5px 8px', borderBottom: '1px solid var(--border)' }}>{inline(cell, `${key}-${ri}-${ci}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
    tableBuffer = null
  }

  lines.forEach((raw, idx) => {
    const line = raw.trim()

    if (/^\|.*\|$/.test(line)) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim())
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) return // separator row
      flushList(`l${idx}`)
      if (!tableBuffer) tableBuffer = []
      tableBuffer.push(cells)
      return
    }
    flushTable(`t${idx}`)

    if (!line) { flushList(`l${idx}`); return }

    const heading = line.match(/^(#{1,4})\s+(.*)/)
    if (heading) {
      flushList(`l${idx}`)
      const level = heading[1].length
      const size = level === 1 ? 18 : level === 2 ? 16 : 14
      blocks.push(<div key={idx} style={{ fontWeight: 700, fontSize: size, margin: '14px 0 6px' }}>{inline(heading[2], `h${idx}`)}</div>)
      return
    }

    const bullet = line.match(/^[-*•]\s+(.*)/)
    if (bullet) {
      if (!listBuffer || listBuffer.ordered) { flushList(`l${idx}`); listBuffer = { ordered: false, items: [] } }
      listBuffer.items.push(bullet[1])
      return
    }

    const numbered = line.match(/^\d+[.)]\s+(.*)/)
    if (numbered) {
      if (!listBuffer || !listBuffer.ordered) { flushList(`l${idx}`); listBuffer = { ordered: true, items: [] } }
      listBuffer.items.push(numbered[1])
      return
    }

    flushList(`l${idx}`)
    blocks.push(<p key={idx} style={{ margin: '4px 0', lineHeight: 1.7 }}>{inline(line, `p${idx}`)}</p>)
  })
  flushList('lend')
  flushTable('tend')

  return <div style={{ fontSize: 13 }}>{blocks}</div>
}
