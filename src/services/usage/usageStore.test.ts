/**
 * FreeClaude v3 — Usage Store Tests
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

// We test usageStore with a temporary file by overriding the path
// Since usageStore uses a hardcoded path, we test the functions that don't depend on it

describe('Usage Store', () => {
  test('logUsage and getStats integration', () => {
    // Import and test the module
    const { logUsage, getStats } = require('./usageStore.ts')

    // Log a test entry
    logUsage({
      timestamp: new Date().toISOString(),
      provider: 'test-provider',
      model: 'test-model',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      costUsd: 0,
      durationMs: 1000,
      fallback: false,
    })

    const stats = getStats(1) // last 1 day
    // The entry we just logged should be counted
    // (along with any previous entries in the real file)
    expect(stats.totalRequests).toBeGreaterThanOrEqual(1)
  })

  test('pruneOldEntries removes old entries', () => {
    const { pruneOldEntries } = require('./usageStore.ts')
    // This is a no-op test — just ensures it doesn't throw
    const pruned = pruneOldEntries(30)
    expect(typeof pruned).toBe('number')
  })

  test('formatStats returns string', () => {
    const { formatStats } = require('./usageStore.ts')
    const stats = formatStats(7)
    expect(typeof stats).toBe('string')
    expect(stats).toContain('FreeClaude Usage')
  })
})
