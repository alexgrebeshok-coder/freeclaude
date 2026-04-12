import type { LocalCommandCall } from '../../types/command.js'
import { getCostSummary, clearCosts } from '../../services/cost/costTracker.js'

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()

  if (trimmed === 'clear') {
    const count = clearCosts()
    return {
      type: 'text',
      value: `🗑 Cleared ${count} cost entries.`,
    }
  }

  // Calculate "since" date
  let since: string | undefined
  let periodLabel = 'all time'

  if (trimmed === 'today') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    since = d.toISOString()
    periodLabel = 'today'
  } else if (trimmed === 'week') {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    since = d.toISOString()
    periodLabel = 'last 7 days'
  } else if (trimmed === 'month') {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    since = d.toISOString()
    periodLabel = 'last 30 days'
  }

  const summary = getCostSummary(since)

  if (summary.totalRequests === 0) {
    return {
      type: 'text',
      value: `No cost data (${periodLabel}).\n\nCosts are tracked automatically when using /cost track.`,
    }
  }

  const lines = [
    `💰 Cost Summary (${periodLabel})`,
    '',
    `  Total Cost: $${summary.totalCost.toFixed(4)}`,
    `  Requests: ${summary.totalRequests}`,
    `  Tokens: ${(summary.totalInputTokens + summary.totalOutputTokens).toLocaleString()}`,
    `  Avg Latency: ${summary.avgLatency}ms`,
    '',
  ]

  // By provider
  const providers = Object.entries(summary.byProvider).sort((a, b) => b[1].cost - a[1].cost)
  if (providers.length > 0) {
    lines.push('  **By Provider:**')
    for (const [name, data] of providers) {
      lines.push(`    ${name}: $${data.cost.toFixed(4)} (${data.requests} requests, ${data.tokens.toLocaleString()} tokens)`)
    }
    lines.push('')
  }

  // By model
  const models = Object.entries(summary.byModel).sort((a, b) => b[1].cost - a[1].cost)
  if (models.length > 0) {
    lines.push('  **By Model:**')
    for (const [name, data] of models) {
      lines.push(`    ${name}: $${data.cost.toFixed(4)} (${data.requests} requests)`)
    }
    lines.push('')
  }

  lines.push('  /cost today|week|month — filter by period')
  lines.push('  /cost clear — reset')

  return {
    type: 'text',
    value: lines.join('\n'),
  }
}
