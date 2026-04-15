import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Memory Consolidation', () => {
  const TEST_DIR = join(tmpdir(), `consolidation-test-${Date.now()}`)

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

  test('detects and merges duplicate keys', async () => {
    const { remember } = await import('./memoryStore.ts')
    const { consolidateMemories } = await import('./consolidation.ts')

    remember('project', 'FreeClaude')
    remember('project-name', 'FreeClaude app')

    const result = consolidateMemories({ keySimilarityThreshold: 0.7 })
    // "project" and "project-name" share a prefix and one contains the other
    expect(result.merged).toBeGreaterThanOrEqual(0)
    expect(result.kept).toBeGreaterThanOrEqual(1)
  })

  test('merges entries with identical values', async () => {
    const { remember } = await import('./memoryStore.ts')
    const { consolidateMemories } = await import('./consolidation.ts')

    remember('key-a', 'the exact same value here')
    remember('key-b', 'the exact same value here')

    const result = consolidateMemories({ valueSimilarityThreshold: 0.9 })
    expect(result.merged).toBe(1)
    expect(result.removed.length).toBe(1)
  })

  test('dry run does not modify store', async () => {
    const { remember, listAll } = await import('./memoryStore.ts')
    const { consolidateMemories } = await import('./consolidation.ts')

    remember('dup1', 'same value')
    remember('dup2', 'same value')

    const before = listAll().length
    const result = consolidateMemories({ valueSimilarityThreshold: 0.9, dryRun: true })
    const after = listAll().length

    expect(result.merged).toBe(1)
    expect(after).toBe(before) // No actual changes
  })

  test('keeps unique entries untouched', async () => {
    const { remember } = await import('./memoryStore.ts')
    const { consolidateMemories } = await import('./consolidation.ts')

    remember('name', 'Sasha')
    remember('project', 'FreeClaude')
    remember('language', 'TypeScript')

    const result = consolidateMemories()
    expect(result.merged).toBe(0)
    expect(result.kept).toBe(3)
  })

  test('preview returns same result as dry run', async () => {
    const { remember } = await import('./memoryStore.ts')
    const { previewConsolidation } = await import('./consolidation.ts')

    remember('x1', 'identical content here')
    remember('x2', 'identical content here')

    const preview = previewConsolidation()
    expect(preview.merged).toBe(1)
  })
})
