import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { anthropicKey, system, messages, maxTokens } = await req.json()
    if (!anthropicKey) return NextResponse.json({ error: 'Missing Anthropic API key' }, { status: 400 })
    if (!Array.isArray(messages) || messages.length === 0) return NextResponse.json({ error: 'Missing messages' }, { status: 400 })

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens || 1200,
        system,
        messages,
      }),
    })
    const d = await r.json()
    if (!r.ok) return NextResponse.json({ error: d?.error?.message || 'Anthropic API error' }, { status: r.status })

    const text = d.content?.[0]?.text || ''
    return NextResponse.json({ text })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
