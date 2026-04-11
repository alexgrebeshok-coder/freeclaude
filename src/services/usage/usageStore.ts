/**
 * FreeClaude v2 — Usage Store
 *
 * Persists token usage to ~/.freeclaude-usage.json (NDJSON format).
 * Provides aggregation for stats display.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const USAGE_FILE = join(homedir(), '.freeclaude-usage.json')

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
  dateRange: { from: string; to: string }
}

/**
 * Log a usage entry.
 */
export function logUsage(entry: UsageEntry): void {
  const line = JSON.stringify(entry) + '\n'
  try {
    appendFileSync(USAGE_FILE, line, 'utf-8')
  } catch {
    // Silent fail — usage tracking is non-critical
  }
}

/**
 * Get aggregated stats for a time period.
 */
export function getStats(days: number = 7): UsageStats {
  if (!existsSync(USAGE_FILE)) {
    return emptyStats()
  }

  try {
    const raw = readFileSync(USAGE_FILE, 'utf-8')
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

  return lines.join('\n')
}

/**
 * Prune old entries (keep last N days).
 */
export function pruneOldEntries(keepDays: number = 30): number {
  if (!existsSync(USAGE_FILE)) return 0

  try {
    const raw = readFileSync(USAGE_FILE, 'utf-8')
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
      writeFileSync(USAGE_FILE, kept.join('\n') + '\n', 'utf-8')
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
    dateRange: { from: new Date().toISOString(), to: new Date().toISOString() },
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
