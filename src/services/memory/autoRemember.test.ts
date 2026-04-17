import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Auto-Remember', () => {
  const TEST_DIR = join(tmpdir(), `autoremember-test-${Date.now()}`)

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

  test('detects "remember that" trigger', async () => {
    const { wouldRemember } = await import('./autoRemember.ts')
    const result = wouldRemember('remember that FreeClaude uses SoX for audio')
    expect(result.detected).toBe(true)
    expect(result.value).toBe('FreeClaude uses SoX for audio')
  })

  test('detects "запомни что" trigger (Russian)', async () => {
    const { wouldRemember } = await import('./autoRemember.ts')
    const result = wouldRemember('запомни что проект называется FreeClaude')
    expect(result.detected).toBe(true)
    expect(result.value).toContain('проект называется FreeClaude')
  })

  test('detects "my name is" trigger', async () => {
    const { wouldRemember } = await import('./autoRemember.ts')
    const result = wouldRemember('my name is Sasha')
    expect(result.detected).toBe(true)
    expect(result.key).toBe('user-name')
    expect(result.value).toBe('Sasha')
  })

  test('detects "I prefer" trigger', async () => {
    const { wouldRemember } = await import('./autoRemember.ts')
    const result = wouldRemember('I prefer TypeScript over JavaScript')
    expect(result.detected).toBe(true)
    expect(result.value).toBe('TypeScript over JavaScript')
  })

  test('does not trigger on random text', async () => {
    const { wouldRemember } = await import('./autoRemember.ts')
    const result = wouldRemember('Tell me about the weather today')
    expect(result.detected).toBe(false)
  })

  test('does not trigger on short text', async () => {
    const { wouldRemember } = await import('./autoRemember.ts')
    const result = wouldRemember('hi')
    expect(result.detected).toBe(false)
  })

  test('detectAndRemember actually saves to memory', async () => {
    const { detectAndRemember } = await import('./autoRemember.ts')
    const { recall } = await import('./memoryStore.ts')

    const result = detectAndRemember('remember that the API key is in .env')
    expect(result.detected).toBe(true)
    expect(result.saved).toBe(true)

    // Verify it was saved
    const entries = require('./memoryStore.ts').listAll()
    expect(entries.length).toBeGreaterThan(0)
  })

  test('project decisions are remembered as project-scoped entries', async () => {
    process.env.FREECLAUDE_MEMORY_PROJECT = 'repo-a'
    const { detectAndRemember } = await import('./autoRemember.ts')
    const { recall } = await import('./memoryStore.ts')

    const result = detectAndRemember('remember that in this project we always use Bun for scripts')
    expect(result.detected).toBe(true)

    const entry = recall(result.key!)
    expect(entry?.scope).toBe('project')
    expect(entry?.category).toBe('decision')
    delete process.env.FREECLAUDE_MEMORY_PROJECT
  })
})
