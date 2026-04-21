import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_DIR = join(tmpdir(), `decay-test-${Date.now()}`)

describe('Memory Decay', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    process.env.FREECLAUDE_MEMORY_DIR = TEST_DIR
  })

  afterEach(() => {
    delete process.env.FREECLAUDE_MEMORY_DIR
    try {
      rmSync(TEST_DIR, { recursive: true, force: true })
    } catch {}
  })

  test('computeConfidence decays over time', async () => {
    const { computeConfidence } = await import('./decay.ts')

    const meta = {
      accessCount: 1,
      lastAccessedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
      confidence: 1.0,
    }

    const conf = computeConfidence(meta)
    // After 10 days at 5%/day: 1.0 * 0.95^10 ≈ 0.5987
    expect(conf).toBeGreaterThan(0.55)
    expect(conf).toBeLessThan(0.65)
  })

  test('computeConfidence returns full confidence for fresh access', async () => {
    const { computeConfidence } = await import('./decay.ts')

    const meta = {
      accessCount: 5,
      lastAccessedAt: new Date().toISOString(),
      confidence: 1.0,
    }

    const conf = computeConfidence(meta)
    expect(conf).toBeCloseTo(1.0, 1)
  })

  test('computeConfidence approaches zero for very old memories', async () => {
    const { computeConfidence } = await import('./decay.ts')

    const meta = {
      accessCount: 1,
      lastAccessedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year ago
      confidence: 1.0,
    }

    const conf = computeConfidence(meta)
    expect(conf).toBeLessThan(0.01)
  })

  test('getDecayMeta returns defaults for plain MemoryEntry', async () => {
    const { getDecayMeta } = await import('./decay.ts')

    const entry = {
      key: 'test',
      value: 'hello',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      tags: [],
    }

    const meta = getDecayMeta(entry)
    expect(meta.accessCount).toBe(0)
    expect(meta.confidence).toBe(1.0)
    expect(meta.lastAccessedAt).toBe('2024-01-01T00:00:00Z')
  })

  test('gcMemories removes low-confidence entries', async () => {
    const { gcMemories } = await import('./decay.ts')
    const { remember, loadMemory, saveMemory } = await import('./memoryStore.ts')

    remember('fresh-key', 'fresh value')
    remember('stale-key', 'stale value')

    // Entries are stored under a composite storage key (e.g. "global:stale-key"),
    // not the raw user key — look up the matching storage key by the entry's
    // "key" field before mutating decay metadata on disk.
    const store = loadMemory()
    const staleStorageKey = Object.keys(store.entries).find(
      storageKey => store.entries[storageKey]?.key === 'stale-key',
    )
    expect(staleStorageKey).toBeDefined()
    const staleEntry = store.entries[staleStorageKey!] as any
    staleEntry.confidence = 0.05 // Below GC threshold
    staleEntry.lastAccessedAt = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    saveMemory(store)

    const result = gcMemories(0.1)
    expect(result.removed).toContain('stale-key')
    expect(result.kept).toBe(1)
  })

  test('getMemoryStats returns correct counts', async () => {
    const { getMemoryStats } = await import('./decay.ts')
    const { remember } = await import('./memoryStore.ts')

    remember('k1', 'v1')
    remember('k2', 'v2')
    remember('k3', 'v3')

    const stats = getMemoryStats()
    expect(stats.total).toBe(3)
    expect(stats.healthy).toBe(3) // All fresh
    expect(stats.averageConfidence).toBeCloseTo(1.0, 1)
  })
})
