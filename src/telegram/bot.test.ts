import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SessionManager } from './services/session.js'
import { RequestQueue } from './services/queue.js'
import { formatFreeClaudeResult } from './services/freeclaude.js'
import type { BotConfig } from './types.js'

const mockConfig: BotConfig = {
  botToken: 'test-token',
  allowedUsers: [123, 456],
  defaultWorkspace: '/tmp/freeclaude-test',
  readRoots: ['/Users/aleksandrgrebeshok'],
  freeclaudePath: 'freeclaude',
  defaultModel: 'zai/glm-5-turbo',
  maxConcurrentPerUser: 2,
  requestTimeoutMs: 5_000,
  voiceEnabled: false,
  ttsVoice: 'ru-RU-DmitryNeural',
  sttModel: '~/.openclaw/models/whisper/ggml-small.bin',
  sttLanguage: 'ru',
}

describe('SessionManager', () => {
  let sm: SessionManager

  beforeEach(() => {
    sm = new SessionManager(mockConfig)
  })

  test('creates a session for a new chat', () => {
    const session = sm.getOrCreate(123)
    expect(session.chatId).toBe(123)
    expect(session.workspace).toBe('/tmp/freeclaude-test')
    expect(session.model).toBe('zai/glm-5-turbo')
    expect(session.voiceMode).toBe(false)
    expect(session.history).toHaveLength(0)
  })

  test('returns the same session on repeated calls', () => {
    const a = sm.getOrCreate(123)
    const b = sm.getOrCreate(123)
    expect(a).toBe(b)
  })

  test('addMessage appends to history and returns context', () => {
    sm.addMessage(123, 'user', 'hello')
    sm.addMessage(123, 'assistant', 'hi there')
    const context = sm.getContext(123)
    expect(context).toHaveLength(2)
    expect(context[0]).toBe('user: hello')
    expect(context[1]).toBe('assistant: hi there')
  })

  test('trims history to MAX_HISTORY (20)', () => {
    for (let i = 0; i < 25; i++) {
      sm.addMessage(123, 'user', `message ${i}`)
    }
    expect(sm.getOrCreate(123).history).toHaveLength(20)
  })

  test('setWorkspace updates the session workspace', () => {
    sm.setWorkspace(123, '/projects/myapp')
    expect(sm.getOrCreate(123).workspace).toBe('/projects/myapp')
  })

  test('setModel updates the session model', () => {
    sm.setModel(123, 'gemini-2.5-flash')
    expect(sm.getOrCreate(123).model).toBe('gemini-2.5-flash')
  })

  test('toggleVoice alternates between true and false', () => {
    expect(sm.toggleVoice(123)).toBe(true)
    expect(sm.toggleVoice(123)).toBe(false)
    expect(sm.toggleVoice(123)).toBe(true)
  })

  test('clearHistory empties the history', () => {
    sm.addMessage(123, 'user', 'test message')
    sm.clearHistory(123)
    expect(sm.getOrCreate(123).history).toHaveLength(0)
  })

  test('getContext returns empty array for unknown chat', () => {
    expect(sm.getContext(999)).toEqual([])
  })

  test('cleanup removes sessions older than 24h', () => {
    const session = sm.getOrCreate(123)
    // Simulate a very old session
    session.lastActivity = Date.now() - 25 * 60 * 60 * 1_000
    const removed = sm.cleanup()
    expect(removed).toBe(1)
    // Session was removed — getOrCreate creates a fresh one
    expect(sm.getOrCreate(123).history).toHaveLength(0)
  })

  test('cleanup does not remove active sessions', () => {
    sm.getOrCreate(123)
    sm.getOrCreate(456)
    expect(sm.cleanup()).toBe(0)
  })
})

describe('RequestQueue', () => {
  let queue: RequestQueue

  beforeEach(() => {
    queue = new RequestQueue(mockConfig)
  })

  test('acquires and releases a single slot', async () => {
    await queue.acquire(123)
    expect(queue.getStatus(123).active).toBe(1)
    queue.release(123)
    expect(queue.getStatus(123).active).toBe(0)
  })

  test('allows up to maxConcurrentPerUser simultaneous slots', async () => {
    await queue.acquire(123)
    await queue.acquire(123) // maxConcurrentPerUser = 2
    expect(queue.getStatus(123).active).toBe(2)
    queue.release(123)
    queue.release(123)
    expect(queue.getStatus(123).active).toBe(0)
  })

  test('queues requests beyond maxConcurrentPerUser', async () => {
    const singleConfig: BotConfig = { ...mockConfig, maxConcurrentPerUser: 1 }
    const singleQueue = new RequestQueue(singleConfig)

    await singleQueue.acquire(123)
    expect(singleQueue.getStatus(123)).toEqual({ active: 1, waiting: 0 })

    let secondAcquired = false
    const p = singleQueue.acquire(123).then(() => {
      secondAcquired = true
    })

    expect(singleQueue.getStatus(123)).toEqual({ active: 1, waiting: 1 })
    expect(secondAcquired).toBe(false)

    singleQueue.release(123)
    await p

    expect(secondAcquired).toBe(true)
    singleQueue.release(123)
    expect(singleQueue.getStatus(123)).toEqual({ active: 0, waiting: 0 })
  })

  test('independent slots per chat', async () => {
    await queue.acquire(123)
    await queue.acquire(456)
    expect(queue.getStatus(123).active).toBe(1)
    expect(queue.getStatus(456).active).toBe(1)
    queue.release(123)
    expect(queue.getStatus(123).active).toBe(0)
    expect(queue.getStatus(456).active).toBe(1)
  })

  test('getStatus returns zeros for unknown chat', () => {
    expect(queue.getStatus(999)).toEqual({ active: 0, waiting: 0 })
  })
})

describe('formatFreeClaudeResult', () => {
  test('removes FreeClaude diagnostic lines from user-facing errors', () => {
    expect(
      formatFreeClaudeResult({
        stdout: '',
        stderr:
          '[FreeClaude] Loaded 2 providers from ~/.freeclaude.json\nError: boom',
        exitCode: 1,
        durationMs: 0,
      }),
    ).toBe('⚠️ Ошибка: Error: boom')
  })
})
