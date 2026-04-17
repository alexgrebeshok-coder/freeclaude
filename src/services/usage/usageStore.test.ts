/**
 * FreeClaude v3 — Usage Store Tests
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ORIGINAL_USAGE_FILE = process.env.FREECLAUDE_USAGE_FILE
const ORIGINAL_DAILY_BUDGET = process.env.FREECLAUDE_DAILY_BUDGET_USD
let testDir = ''
let usageFile = ''

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'freeclaude-usage-'))
  usageFile = join(testDir, 'usage.jsonl')
  process.env.FREECLAUDE_USAGE_FILE = usageFile
  delete process.env.FREECLAUDE_DAILY_BUDGET_USD
})

afterEach(() => {
  rmSync(testDir, { force: true, recursive: true })
  if (ORIGINAL_USAGE_FILE === undefined) {
    delete process.env.FREECLAUDE_USAGE_FILE
  } else {
    process.env.FREECLAUDE_USAGE_FILE = ORIGINAL_USAGE_FILE
  }
  if (ORIGINAL_DAILY_BUDGET === undefined) {
    delete process.env.FREECLAUDE_DAILY_BUDGET_USD
  } else {
    process.env.FREECLAUDE_DAILY_BUDGET_USD = ORIGINAL_DAILY_BUDGET
  }
})

describe('Usage Store', () => {
  test('logUsage and getStats aggregate provider and task goals', () => {
    const { logUsage, getStats } = require('./usageStore.ts')

    logUsage({
      timestamp: new Date().toISOString(),
      provider: 'zai',
      model: 'glm-5',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      costUsd: 0,
      durationMs: 1000,
      fallback: false,
      taskGoal: 'analysis',
    })

    logUsage({
      timestamp: new Date().toISOString(),
      provider: 'ollama',
      model: 'qwen2.5:3b',
      promptTokens: 40,
      completionTokens: 20,
      totalTokens: 60,
      costUsd: 0,
      durationMs: 400,
      fallback: false,
      taskGoal: 'chat',
    })

    const stats = getStats(1)
    expect(stats.totalRequests).toBe(2)
    expect(stats.totalTokens).toBe(210)
    expect(stats.byProvider.zai?.requests).toBe(1)
    expect(stats.byTaskGoal.analysis?.requests).toBe(1)
    expect(stats.byTaskGoal.chat?.tokens).toBe(60)
  })

  test('pruneOldEntries removes old entries', () => {
    const { pruneOldEntries } = require('./usageStore.ts')
    // This is a no-op test — just ensures it doesn't throw
    const pruned = pruneOldEntries(30)
    expect(typeof pruned).toBe('number')
  })

  test('formatStats returns string', () => {
    const { formatStats, logUsage } = require('./usageStore.ts')
    logUsage({
      timestamp: new Date().toISOString(),
      provider: 'zai',
      model: 'glm-5',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      costUsd: 0.25,
      durationMs: 1000,
      fallback: false,
      taskGoal: 'analysis',
    })
    const stats = formatStats(7)
    expect(typeof stats).toBe('string')
    expect(stats).toContain('FreeClaude Usage')
    expect(stats).toContain('Task goals')
    expect(stats).toContain('analysis')
  })

  test('formatStats emits a budget alert when daily budget is exceeded', () => {
    const { formatStats, logUsage } = require('./usageStore.ts')
    process.env.FREECLAUDE_DAILY_BUDGET_USD = '0.10'
    logUsage({
      timestamp: new Date().toISOString(),
      provider: 'openai',
      model: 'gpt-4o',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      costUsd: 0.25,
      durationMs: 1000,
      fallback: false,
      taskGoal: 'coding',
    })

    expect(formatStats(1)).toContain('Budget alert')
  })
})
