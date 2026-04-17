/**
 * FreeClaude v2 — Usage Store
 *
 * Persists token usage to ~/.freeclaude-usage.json (NDJSON format).
 * Provides aggregation for stats display.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_USAGE_FILE = join(homedir(), '.freeclaude-usage.json')

function getUsageFilePath(): string {
  return process.env.FREECLAUDE_USAGE_FILE?.trim() || DEFAULT_USAGE_FILE
}

export interface UsageEntry {
  timestamp: string
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  durationMs: number
  fallback: boolean
  taskGoal?: 'coding' | 'chat' | 'analysis'
}

export interface UsageStats {
  totalRequests: number
  totalTokens: number
  totalCostUsd: number
  byProvider: Record<string, {
    requests: number
    tokens: number
    costUsd: number
  }>
  byTaskGoal: Record<string, {
    requests: number
    tokens: number
    costUsd: number
  }>
  dateRange: { from: string; to: string }
}

/**
 * Log a usage entry.
 */
export function logUsage(entry: UsageEntry): void {
  const line = JSON.stringify(entry) + '\n'
  try {
    appendFileSync(getUsageFilePath(), line, 'utf-8')
  } catch {
    // Silent fail — usage tracking is non-critical
  }
}

/**
 * Get aggregated stats for a time period.
 */
export function getStats(days: number = 7): UsageStats {
  const usageFile = getUsageFilePath()
  if (!existsSync(usageFile)) {
    return emptyStats()
  }

  try {
    const raw = readFileSync(usageFile, 'utf-8')
    const lines = raw.trim().split('\n').filter(Boolean)

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    const stats: UsageStats = emptyStats()
    let earliest = new Date().toISOString()
    let latest = ''

    for (const line of lines) {
      try {
        const entry: UsageEntry = JSON.parse(line)
        const entryDate = new Date(entry.timestamp)

        if (entryDate >= cutoff) {
          stats.totalRequests++
          stats.totalTokens += entry.totalTokens
          stats.totalCostUsd += entry.costUsd

          if (!stats.byProvider[entry.provider]) {
            stats.byProvider[entry.provider] = { requests: 0, tokens: 0, costUsd: 0 }
          }
          stats.byProvider[entry.provider].requests++
          stats.byProvider[entry.provider].tokens += entry.totalTokens
          stats.byProvider[entry.provider].costUsd += entry.costUsd

          if (entry.taskGoal) {
            if (!stats.byTaskGoal[entry.taskGoal]) {
              stats.byTaskGoal[entry.taskGoal] = {
                requests: 0,
                tokens: 0,
                costUsd: 0,
              }
            }
            stats.byTaskGoal[entry.taskGoal].requests++
            stats.byTaskGoal[entry.taskGoal].tokens += entry.totalTokens
            stats.byTaskGoal[entry.taskGoal].costUsd += entry.costUsd
          }

          if (entry.timestamp < earliest) earliest = entry.timestamp
          if (entry.timestamp > latest) latest = entry.timestamp
        }
      } catch {
        // Skip malformed lines
      }
    }

    stats.dateRange = { from: earliest, to: latest || earliest }
    return stats
  } catch {
    return emptyStats()
  }
}

/**
 * Format stats as a table string.
 */
export function formatStats(days: number = 7): string {
  const stats = getStats(days)

  const lines = [
    `FreeClaude Usage (${days} days)`,
    '━'.repeat(40),
    `Provider     | Requests | Tokens   | Cost`,
  ]

  for (const [provider, data] of Object.entries(stats.byProvider)) {
    lines.push(
      `${provider.padEnd(12)} | ${String(data.requests).padStart(8)} | ${formatNumber(data.tokens).padStart(8)} | $${data.costUsd.toFixed(4)}`,
    )
  }

  lines.push('━'.repeat(40))
  lines.push(
    `${'TOTAL'.padEnd(12)} | ${String(stats.totalRequests).padStart(8)} | ${formatNumber(stats.totalTokens).padStart(8)} | $${stats.totalCostUsd.toFixed(4)}`,
  )

  if (Object.keys(stats.byTaskGoal).length > 0) {
    lines.push('', 'Task goals', '━'.repeat(40), 'Goal         | Requests | Tokens   | Cost')
    for (const [goal, data] of Object.entries(stats.byTaskGoal)) {
      lines.push(
        `${goal.padEnd(12)} | ${String(data.requests).padStart(8)} | ${formatNumber(data.tokens).padStart(8)} | $${data.costUsd.toFixed(4)}`,
      )
    }
  }

  const budgetAlert = getBudgetAlert(days, stats.totalCostUsd)
  if (budgetAlert) {
    lines.push('', budgetAlert)
  }

  return lines.join('\n')
}

function getBudgetAlert(days: number, totalCostUsd: number): string {
  const budgetValue =
    days <= 1
      ? process.env.FREECLAUDE_DAILY_BUDGET_USD
      : days <= 7
        ? process.env.FREECLAUDE_WEEKLY_BUDGET_USD
        : undefined
  const budgetUsd = Number.parseFloat(budgetValue ?? '')
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return ''
  }
  if (totalCostUsd <= budgetUsd) {
    return ''
  }
  return `Budget alert: spent $${totalCostUsd.toFixed(4)} over configured $${budgetUsd.toFixed(4)} for the last ${days} day(s).`
}

/**
 * Prune old entries (keep last N days).
 */
export function pruneOldEntries(keepDays: number = 30): number {
  const usageFile = getUsageFilePath()
  if (!existsSync(usageFile)) return 0

  try {
    const raw = readFileSync(usageFile, 'utf-8')
    const lines = raw.trim().split('\n').filter(Boolean)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - keepDays)

    const kept: string[] = []
    let pruned = 0

    for (const line of lines) {
      try {
        const entry: UsageEntry = JSON.parse(line)
        if (new Date(entry.timestamp) >= cutoff) {
          kept.push(line)
        } else {
          pruned++
        }
      } catch {
        kept.push(line) // Keep unparseable lines just in case
      }
    }

    if (pruned > 0) {
      writeFileSync(usageFile, kept.join('\n') + '\n', 'utf-8')
    }

    return pruned
  } catch {
    return 0
  }
}

function emptyStats(): UsageStats {
  return {
    totalRequests: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    byProvider: {},
    byTaskGoal: {},
    dateRange: { from: new Date().toISOString(), to: new Date().toISOString() },
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
