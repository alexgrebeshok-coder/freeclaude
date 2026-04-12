import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, rmSync } from 'node:fs'

let counter = 0

beforeEach(() => {
  counter++
  process.env.FREECLAUDE_COST_DIR = join(tmpdir(), `fc-cost-${counter}`)
  mkdirSync(process.env.FREECLAUDE_COST_DIR, { recursive: true })
})

afterEach(() => {
  const dir = process.env.FREECLAUDE_COST_DIR
  delete process.env.FREECLAUDE_COST_DIR
  try { rmSync(dir!, { recursive: true, force: true }) } catch {}
})

describe('Cost Tracker', () => {
  test('trackCost returns estimated cost', async () => {
    const { trackCost } = await import('../../services/cost/costTracker.ts')
    const entry = trackCost({
      provider: 'zai',
      model: 'glm-4.7-flash',
      inputTokens: 1000,
      outputTokens: 500,
      latencyMs: 200,
    })
    expect(entry.estimatedCost).toBeGreaterThan(0)
    expect(entry.provider).toBe('zai')
    expect(entry.timestamp).toBeDefined()
  })

  test('free providers have zero cost', async () => {
    const { trackCost } = await import('../../services/cost/costTracker.ts')
    const entry = trackCost({
      provider: 'ollama',
      model: 'qwen2.5:3b',
      inputTokens: 50000,
      outputTokens: 10000,
      latencyMs: 500,
    })
    expect(entry.estimatedCost).toBe(0)
  })

  test('getCostSummary aggregates correctly', async () => {
    const { trackCost, getCostSummary } = await import('../../services/cost/costTracker.ts')
    trackCost({ provider: 'zai', model: 'glm-4.7-flash', inputTokens: 1000, outputTokens: 500, latencyMs: 100 })
    trackCost({ provider: 'zai', model: 'glm-4.7-flash', inputTokens: 2000, outputTokens: 1000, latencyMs: 200 })
    trackCost({ provider: 'openai', model: 'gpt-4o', inputTokens: 500, outputTokens: 200, latencyMs: 300 })

    const summary = getCostSummary()
    expect(summary.totalRequests).toBe(3)
    expect(summary.totalInputTokens).toBe(3500)
    expect(summary.totalOutputTokens).toBe(1700)
    expect(summary.byProvider['zai']!.requests).toBe(2)
    expect(summary.byProvider['openai']!.requests).toBe(1)
  })

  test('getCostSummary filters by date', async () => {
    const { trackCost, getCostSummary } = await import('../../services/cost/costTracker.ts')
    trackCost({ provider: 'zai', model: 'glm-4.7-flash', inputTokens: 1000, outputTokens: 500, latencyMs: 100 })

    // "today" filter — should include
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todaySummary = getCostSummary(today.toISOString())
    expect(todaySummary.totalRequests).toBe(1)

    // Future date — should exclude
    const future = new Date(Date.now() + 86400000).toISOString()
    const futureSummary = getCostSummary(future)
    expect(futureSummary.totalRequests).toBe(0)
  })

  test('clearCosts removes all entries', async () => {
    const { trackCost, getCostSummary, clearCosts } = await import('../../services/cost/costTracker.ts')
    trackCost({ provider: 'zai', model: 'glm-4.7-flash', inputTokens: 100, outputTokens: 50, latencyMs: 50 })
    trackCost({ provider: 'zai', model: 'glm-4.7-flash', inputTokens: 200, outputTokens: 100, latencyMs: 60 })

    const count = clearCosts()
    expect(count).toBe(2)

    const summary = getCostSummary()
    expect(summary.totalRequests).toBe(0)
  })

  test('handles missing file gracefully', async () => {
    const { getCostSummary } = await import('../../services/cost/costTracker.ts')
    const summary = getCostSummary()
    expect(summary.totalCost).toBe(0)
    expect(summary.totalRequests).toBe(0)
  })
})
