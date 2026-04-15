import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Context Compactor', () => {
  const TEST_DIR = join(tmpdir(), `compactor-test-${Date.now()}`)

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
  })

  test('estimateTokens gives reasonable estimates', async () => {
    const { estimateTokens } = await import('./compactor.ts')

    // ~4 chars per token for English
    const tokens = estimateTokens('Hello world, this is a test message.')
    expect(tokens).toBeGreaterThan(5)
    expect(tokens).toBeLessThan(20)
  })

  test('estimateConversationTokens sums all messages', async () => {
    const { estimateConversationTokens } = await import('./compactor.ts')

    const tokens = estimateConversationTokens([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there! How can I help?' },
      { role: 'user', content: 'Tell me about TypeScript' },
    ])

    expect(tokens).toBeGreaterThan(10)
  })

  test('shouldCompact returns false when under threshold', async () => {
    const { shouldCompact } = await import('./compactor.ts')

    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi!' },
    ]

    expect(shouldCompact(messages, 200_000)).toBe(false)
  })

  test('shouldCompact returns true when over threshold', async () => {
    const { shouldCompact } = await import('./compactor.ts')

    // Create a large conversation
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'x'.repeat(1000),
    }))

    // With a small window, should trigger
    expect(shouldCompact(messages, 100)).toBe(true)
  })

  test('shouldCompact respects autoEnabled=false', async () => {
    const { shouldCompact } = await import('./compactor.ts')

    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'x'.repeat(1000),
    }))

    expect(shouldCompact(messages, 100, { autoEnabled: false })).toBe(false)
  })

  test('compactConversation preserves recent messages', async () => {
    const { compactConversation } = await import('./compactor.ts')

    const messages = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Message ${i}: ${i % 2 === 0 ? 'user request' : 'assistant response'}`,
    }))

    const result = compactConversation(messages, { keepRecentTurns: 5 })

    expect(result.compacted).toBe(true)
    expect(result.messagesBefore).toBe(40)
    expect(result.messagesAfter).toBe(11) // 5 turns * 2 + 1 summary
    expect(result.summary).toContain('summary')
    expect(result.tokensSaved).toBeGreaterThan(0)
  })

  test('compactConversation does not compact short conversations', async () => {
    const { compactConversation } = await import('./compactor.ts')

    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi!' },
    ]

    const result = compactConversation(messages, { keepRecentTurns: 10 })
    expect(result.compacted).toBe(false)
  })

  test('summary extracts decisions and errors', async () => {
    const { compactConversation } = await import('./compactor.ts')

    const messages = [
      { role: 'user' as const, content: 'Let us start a new project.' },
      { role: 'assistant' as const, content: 'I decided to use TypeScript for this project.' },
      { role: 'user' as const, content: 'There is an error in the build.' },
      { role: 'assistant' as const, content: 'Error: Module not found, fixing now.' },
      { role: 'user' as const, content: 'Actually, use JavaScript instead.' },
      { role: 'assistant' as const, content: 'Correction noted, switching to JavaScript.' },
      // Pad with enough messages to trigger compaction
      ...Array.from({ length: 24 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Filler message ${i} to ensure compaction triggers.`,
      })),
    ]

    const result = compactConversation(messages, { keepRecentTurns: 5 })
    expect(result.compacted).toBe(true)
    expect(result.summary).toContain('[Decision]')
    expect(result.summary).toContain('[Error]')
  })
})
