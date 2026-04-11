/**
 * FreeClaude v3 — Fallback Enhanced Tests
 */

import { describe, expect, test, beforeEach } from 'bun:test'
import {
  recordLatency,
  getProviderHealth,
  getFastestProvider,
  formatHealthReport,
  clearLatencyHistory,
} from './fallbackEnhanced.ts'

describe('Fallback Enhanced', () => {
  beforeEach(() => {
    clearLatencyHistory()
  })

  test('records latency and reports health', () => {
    recordLatency('zai', 200, true)
    recordLatency('zai', 300, true)
    recordLatency('zai', 100, false)

    const health = getProviderHealth()
    expect(health.length).toBe(1)
    expect(health[0].name).toBe('zai')
    expect(health[0].avgLatencyMs).toBe(200) // (200+300+100)/3
    expect(health[0].successRate).toBeCloseTo(0.667, 1) // 2/3
    expect(health[0].totalRequests).toBe(3)
    expect(health[0].errorCount).toBe(1)
  })

  test('identifies fastest provider', () => {
    recordLatency('slow-provider', 500, true)
    recordLatency('slow-provider', 600, true)
    recordLatency('fast-provider', 100, true)
    recordLatency('fast-provider', 120, true)

    const fastest = getFastestProvider()
    expect(fastest).toBe('fast-provider')
  })

  test('returns null when no providers have enough data', () => {
    recordLatency('new-provider', 100, true) // only 1 request
    expect(getFastestProvider()).toBeNull()
  })

  test('excludes unhealthy providers from fastest', () => {
    recordLatency('bad-provider', 50, false)
    recordLatency('bad-provider', 50, false)
    recordLatency('good-provider', 200, true)
    recordLatency('good-provider', 210, true)

    const fastest = getFastestProvider()
    expect(fastest).toBe('good-provider')
  })

  test('formatHealthReport returns readable string', () => {
    recordLatency('test', 150, true)

    const report = formatHealthReport()
    expect(report).toContain('FreeClaude Provider Health')
    expect(report).toContain('test')
    expect(report).toContain('150ms')
  })

  test('clearLatencyHistory clears all data', () => {
    recordLatency('test', 100, true)
    clearLatencyHistory()
    expect(getProviderHealth().length).toBe(0)
  })

  test('handles multiple providers', () => {
    recordLatency('zai', 100, true)
    recordLatency('ollama', 200, true)
    recordLatency('gemini', 150, false)

    const health = getProviderHealth()
    expect(health.length).toBe(3)
    expect(health.map(h => h.name)).toContain('zai')
    expect(health.map(h => h.name)).toContain('ollama')
    expect(health.map(h => h.name)).toContain('gemini')
  })
})
