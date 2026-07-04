import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { ticker, fmpKey } = await req.json()
    if (!fmpKey) return NextResponse.json({ quarterlyIncome: [], annualIncome: [], quarterlyEstimates: [], annualEstimates: [] })

    const [incomeQ, incomeA, estQ, estA] = await Promise.all([
      fetch(`https://financialmodelingprep.com/stable/income-statement?symbol=${ticker}&period=quarter&limit=5&apikey=${fmpKey}`).then(r => r.json()).catch(() => []),
      fetch(`https://financialmodelingprep.com/stable/income-statement?symbol=${ticker}&limit=5&apikey=${fmpKey}`).then(r => r.json()).catch(() => []),
      fetch(`https://financialmodelingprep.com/stable/analyst-estimates?symbol=${ticker}&period=quarter&limit=5&apikey=${fmpKey}`).then(r => r.json()).catch(() => []),
      fetch(`https://financialmodelingprep.com/stable/analyst-estimates?symbol=${ticker}&period=annual&limit=3&apikey=${fmpKey}`).then(r => r.json()).catch(() => []),
    ])

    return NextResponse.json({
      quarterlyIncome: Array.isArray(incomeQ) ? incomeQ : [],
      annualIncome: Array.isArray(incomeA) ? incomeA : [],
      quarterlyEstimates: Array.isArray(estQ) ? estQ : [],
      annualEstimates: Array.isArray(estA) ? estA : [],
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
