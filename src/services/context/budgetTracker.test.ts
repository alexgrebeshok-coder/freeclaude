import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'

describe('Budget Tracker', () => {
  test('startSession returns session ID', async () => {
    const { startSession } = await import('./budgetTracker.ts')
    const id = startSession('test-session-1')
    expect(id).toBe('test-session-1')
  })

  test('recordUsage tracks tokens', async () => {
    const { startSession, recordUsage, getSessionUsage } = await import('./budgetTracker.ts')

    startSession('tracker-test')
    recordUsage('ollama', 'qwen3', 1000, 500)
    recordUsage('ollama', 'qwen3', 2000, 1000)

    const usage = getSessionUsage()
    expect(usage).not.toBeNull()
    expect(usage!.totals.inputTokens).toBe(3000)
    expect(usage!.totals.outputTokens).toBe(1500)
    expect(usage!.totals.requests).toBe(2)
  })

  test('recordUsage estimates cost for known models', async () => {
    const { startSession, recordUsage } = await import('./budgetTracker.ts')

    startSession('cost-test')
    const entry = recordUsage('anthropic', 'claude-sonnet-4', 1_000_000, 500_000)

    // claude-sonnet-4: $3/M input + $15/M output
    // Cost: 1M * 3/1M + 500K * 15/1M = 3 + 7.5 = 10.5
    expect(entry.costUsd).toBeGreaterThan(0)
  })

  test('recordUsage shows free for local models', async () => {
    const { startSession, recordUsage } = await import('./budgetTracker.ts')

    startSession('local-test')
    const entry = recordUsage('ollama', 'qwen3', 1000, 500)
    expect(entry.costUsd).toBe(0)
  })

  test('formatSessionUsage produces readable output', async () => {
    const { startSession, recordUsage, formatSessionUsage } = await import('./budgetTracker.ts')

    startSession('format-test')
    recordUsage('ollama', 'qwen3', 5000, 2000)

    const output = formatSessionUsage()
    expect(output).toContain('Session Usage')
    expect(output).toContain('format-test')
  })

  test('formatLifetimeUsage produces output', async () => {
    const { formatLifetimeUsage } = await import('./budgetTracker.ts')
    const output = formatLifetimeUsage()
    expect(output).toContain('Lifetime Usage')
  })
})
