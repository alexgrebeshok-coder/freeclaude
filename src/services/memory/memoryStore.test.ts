import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, rmSync } from 'node:fs'

let testCounter = 0

beforeEach(() => {
  testCounter++
  process.env.FREECLAUDE_MEMORY_DIR = join(tmpdir(), `fc-mem-${testCounter}`)
  mkdirSync(process.env.FREECLAUDE_MEMORY_DIR, { recursive: true })
})

afterEach(() => {
  const dir = process.env.FREECLAUDE_MEMORY_DIR
  delete process.env.FREECLAUDE_MEMORY_DIR
  try { rmSync(dir!, { recursive: true, force: true }) } catch {}
})

describe('Memory Store', () => {
  test('remember and recall', async () => {
    const store = await import('../../services/memory/memoryStore.ts')
    store.remember('name', 'Sasha')
    const entry = store.recall('name')
    expect(entry).toBeDefined()
    expect(entry!.value).toBe('Sasha')
  })

  test('remember with tags', async () => {
    const store = await import('../../services/memory/memoryStore.ts')
    store.remember('apiKey', 'sk-1234', ['sensitive', 'credentials'])
    const entry = store.recall('apiKey')
    expect(entry!.tags).toEqual(['sensitive', 'credentials'])
  })

  test('remember updates existing', async () => {
    const store = await import('../../services/memory/memoryStore.ts')
    store.remember('project', 'FreeClaude')
    store.remember('project', 'FreeClaude v3')
    const entry = store.recall('project')
    expect(entry!.value).toBe('FreeClaude v3')
    expect(entry!.createdAt).toBe(entry!.createdAt)
  })

  test('forget removes entry', async () => {
    const store = await import('../../services/memory/memoryStore.ts')
    store.remember('temp', 'temporary')
    expect(store.forget('temp')).toBe(true)
    expect(store.recall('temp')).toBeUndefined()
  })

  test('forget returns false for non-existent', async () => {
    const store = await import('../../services/memory/memoryStore.ts')
    expect(store.forget('nonexistent')).toBe(false)
  })

  test('search by key', async () => {
    const store = await import('../../services/memory/memoryStore.ts')
    store.remember('project CEOClaw', 'PM dashboard')
    store.remember('project FreeClaude', 'CLI tool')
    const results = store.search('project')
    expect(results.length).toBeGreaterThanOrEqual(2)
  })

  test('search by value', async () => {
    const store = await import('../../services/memory/memoryStore.ts')
    store.remember('tool1', 'TypeScript compiler')
    store.remember('tool2', 'Bun runtime')
    const results = store.search('TypeScript')
    expect(results).toHaveLength(1)
    expect(results[0]!.key).toBe('tool1')
  })

  test('search by tags', async () => {
    const store = await import('../../services/memory/memoryStore.ts')
    store.remember('key1', 'secret', ['sensitive'])
    store.remember('key2', 'public', ['public'])
    const results = store.search('sensitive')
    expect(results).toHaveLength(1)
    expect(results[0]!.key).toBe('key1')
  })

  test('listAll returns sorted by updatedAt', async () => {
    const store = await import('../../services/memory/memoryStore.ts')
    store.remember('old', 'first')
    await new Promise(r => setTimeout(r, 10))
    store.remember('new', 'second')
    const all = store.listAll()
    expect(all).toHaveLength(2)
    expect(all[0]!.key).toBe('new')
  })

  test('clearAll removes everything', async () => {
    const store = await import('../../services/memory/memoryStore.ts')
    store.remember('a', '1')
    store.remember('b', '2')
    store.remember('c', '3')
    const count = store.clearAll()
    expect(count).toBe(3)
    expect(store.listAll()).toHaveLength(0)
  })

  test('exportMarkdown generates valid markdown', async () => {
    const store = await import('../../services/memory/memoryStore.ts')
    store.remember('name', 'Sasha', ['personal'])
    const md = store.exportMarkdown()
    expect(md).toContain('# FreeClaude Memory')
    expect(md).toContain('Sasha')
    expect(md).toContain('personal')
  })

  test('handles corrupted JSON gracefully', async () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(process.env.FREECLAUDE_MEMORY_DIR!, 'memory.json'), 'not json{')
    // Need fresh import
    const store = await import('../../services/memory/memoryStore.ts')
    expect(store.listAll()).toHaveLength(0)
  })

  test('handles missing file', async () => {
    const store = await import('../../services/memory/memoryStore.ts')
    expect(store.listAll()).toHaveLength(0)
  })
})
