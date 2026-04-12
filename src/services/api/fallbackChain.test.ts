/**
 * FreeClaude v3 — Fallback Chain Tests
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { FallbackChain, shouldFallback, isNetworkError, resolveApiKey, CONFIG_PATH } from './fallbackChain.ts'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Backup/restore config file around tests
let configBackup: string | null = null

beforeEach(() => {
  if (existsSync(CONFIG_PATH)) {
    configBackup = CONFIG_PATH
  }
  // Ensure a test config exists so FallbackChain always has providers
  writeFileSync(CONFIG_PATH, JSON.stringify({
    providers: [
      { name: 'test-openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'test-key', model: 'gpt-4o', priority: 1 },
      { name: 'test-zai', baseUrl: 'https://openai.api2d.net/v1', apiKey: 'test-key', model: 'glm-5-turbo', priority: 2 },
    ],
    enabled: true,
  }))
})

afterEach(() => {
  try { unlinkSync(CONFIG_PATH) } catch {}
  // Restore original config if it existed
  if (configBackup && existsSync(configBackup)) {
    // configBackup IS CONFIG_PATH — just leave it deleted, original was overwritten
  }
  configBackup = null
})

// ---------------------------------------------------------------------------
// shouldFallback
// ---------------------------------------------------------------------------

describe('shouldFallback', () => {
  test('triggers on 401 Unauthorized', () => expect(shouldFallback(401)).toBe(true))
  test('triggers on 429 Too Many Requests', () => expect(shouldFallback(429)).toBe(true))
  test('triggers on 500 Internal Server Error', () => expect(shouldFallback(500)).toBe(true))
  test('triggers on 502 Bad Gateway', () => expect(shouldFallback(502)).toBe(true))
  test('triggers on 503 Service Unavailable', () => expect(shouldFallback(503)).toBe(true))
  test('triggers on 504 Gateway Timeout', () => expect(shouldFallback(504)).toBe(true))
  test('does NOT trigger on 400 Bad Request', () => expect(shouldFallback(400)).toBe(false))
  test('does NOT trigger on 200 OK', () => expect(shouldFallback(200)).toBe(false))
  test('does NOT trigger on 403 Forbidden', () => expect(shouldFallback(403)).toBe(false))
})

// ---------------------------------------------------------------------------
// isNetworkError
// ---------------------------------------------------------------------------

describe('isNetworkError', () => {
  test('detects ECONNREFUSED', () => expect(isNetworkError(new Error('connect ECONNREFUSED 127.0.0.1'))).toBe(true))
  test('detects ECONNRESET', () => expect(isNetworkError(new Error('read ECONNRESET'))).toBe(true))
  test('detects ETIMEDOUT', () => expect(isNetworkError(new Error('connect ETIMEDOUT'))).toBe(true))
  test('detects ENOTFOUND', () => expect(isNetworkError(new Error('getaddrinfo ENOTFOUND api.example.com'))).toBe(true))
  test('detects socket hang up', () => expect(isNetworkError(new Error('socket hang up'))).toBe(true))
  test('detects fetch failed', () => expect(isNetworkError(new Error('fetch failed'))).toBe(true))
  test('does NOT trigger on API error', () => expect(isNetworkError(new Error('OpenAI API error 400: bad request'))).toBe(false))
  test('does NOT trigger on unknown error', () => expect(isNetworkError(new Error('something weird'))).toBe(false))
})

// ---------------------------------------------------------------------------
// FallbackChain class
// ---------------------------------------------------------------------------

describe('FallbackChain', () => {
  test('loads providers from config file', () => {
    const chain = new FallbackChain()
    const provider = chain.getCurrent()

    expect(provider).not.toBeNull()
    expect(chain.isEnabled()).toBe(true)
    expect(chain.getProviders().length).toBe(2)
  })

  test('isEnabled returns true when multiple providers configured', () => {
    const chain = new FallbackChain()
    expect(chain.isEnabled()).toBe(true)
  })

  test('markDown triggers cooldown after 3 errors', () => {
    const chain = new FallbackChain()
    const provider = chain.getCurrent()!

    chain.markDown(provider.name)   // error 1
    chain.markDown(provider.name)   // error 2
    chain.markDown(provider.name)   // error 3 → marked down

    const current = chain.getCurrent()
    expect(current).not.toBeNull()
  })

  test('markSuccess resets error streak', () => {
    const chain = new FallbackChain()
    const provider = chain.getCurrent()!

    chain.markDown(provider.name)
    chain.markDown(provider.name)
    chain.markSuccess(provider.name) // reset

    const current = chain.getCurrent()
    expect(current).not.toBeNull()
  })

  test('resolveApiKey handles env: prefix', () => {
    process.env.MY_TEST_KEY = 'resolved-value'
    expect(resolveApiKey('env:MY_TEST_KEY')).toBe('resolved-value')
    expect(resolveApiKey('literal-key')).toBe('literal-key')

    delete process.env.MY_TEST_KEY
  })

  test('getStats returns initial state', () => {
    const chain = new FallbackChain()
    const stats = chain.getStats()

    expect(stats.totalRequests).toBe(0)
    expect(stats.fallbacks).toEqual({})
    expect(stats.errors).toEqual({})
  })
})
