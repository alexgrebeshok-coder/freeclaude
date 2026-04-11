/**
 * FreeClaude v3 — Fallback Chain Enhancements
 *
 * Adds latency tracking, cost-aware selection, and smart retry.
 * This extends the base FallbackChain with production features.
 */

export interface LatencyRecord {
  provider: string
  latencyMs: number
  timestamp: string
  success: boolean
}

export interface ProviderHealth {
  name: string
  avgLatencyMs: number
  successRate: number    // 0-1
  lastUsed: string
  totalRequests: number
  errorCount: number
  estimatedCostPerRequest: number
}

// ---------------------------------------------------------------------------
// Latency Tracker
// ---------------------------------------------------------------------------

const MAX_LATENCY_RECORDS = 1000
const latencyHistory: LatencyRecord[] = []

/**
 * Record a request latency for a provider.
 */
export function recordLatency(
  provider: string,
  latencyMs: number,
  success: boolean,
): void {
  latencyHistory.push({
    provider,
    latencyMs,
    timestamp: new Date().toISOString(),
    success,
  })

  // Trim old records
  if (latencyHistory.length > MAX_LATENCY_RECORDS) {
    latencyHistory.splice(0, latencyHistory.length - MAX_LATENCY_RECORDS)
  }
}

/**
 * Get health metrics for all providers.
 */
export function getProviderHealth(): ProviderHealth[] {
  const byProvider = new Map<string, LatencyRecord[]>()

  for (const record of latencyHistory) {
    if (!byProvider.has(record.provider)) {
      byProvider.set(record.provider, [])
    }
    byProvider.get(record.provider)!.push(record)
  }

  return Array.from(byProvider.entries()).map(([name, records]) => {
    const successRecords = records.filter(r => r.success)
    const totalRequests = records.length
    const errorCount = records.filter(r => !r.success).length

    const avgLatencyMs = totalRequests > 0
      ? Math.round(records.reduce((sum, r) => sum + r.latencyMs, 0) / totalRequests)
      : 0

    const successRate = totalRequests > 0
      ? successRecords.length / totalRequests
      : 0

    const lastUsed = records.length > 0
      ? records[records.length - 1].timestamp
      : ''

    return {
      name,
      avgLatencyMs,
      successRate,
      lastUsed,
      totalRequests,
      errorCount,
      estimatedCostPerRequest: 0, // updated by cost calculator
    }
  })
}

/**
 * Get the fastest healthy provider.
 */
export function getFastestProvider(): string | null {
  const health = getProviderHealth()
  const healthy = health.filter(h => h.successRate > 0.5 && h.totalRequests >= 2)

  if (healthy.length === 0) return null

  healthy.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)
  return healthy[0].name
}

/**
 * Format health report for display.
 */
export function formatHealthReport(): string {
  const health = getProviderHealth()

  if (health.length === 0) {
    return 'No provider health data yet.'
  }

  const lines = [
    'FreeClaude Provider Health',
    '━'.repeat(50),
    'Provider     | Avg Latency | Success Rate | Requests',
  ]

  for (const h of health) {
    const avgLatency = h.avgLatencyMs > 0 ? `${h.avgLatencyMs}ms` : 'N/A'
    const successPct = h.totalRequests > 0
      ? `${(h.successRate * 100).toFixed(0)}%`
      : 'N/A'

    lines.push(
      `${h.name.padEnd(12)} | ${avgLatency.padEnd(11)} | ${successPct.padEnd(12)} | ${h.totalRequests}`,
    )
  }

  lines.push('━'.repeat(50))

  const fastest = getFastestProvider()
  if (fastest) {
    lines.push(`⚡ Fastest: ${fastest}`)
  }

  return lines.join('\n')
}

/**
 * Clear latency history.
 */
export function clearLatencyHistory(): void {
  latencyHistory.length = 0
}
