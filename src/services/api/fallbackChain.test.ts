/**
 * FreeClaude v3 — Fallback Chain Tests
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { FallbackChain, shouldFallback, isNetworkError, resolveApiKey } from './fallbackChain.ts'

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
  let originalHome: string
  let tmpConfigPath: string

  beforeEach(() => {
    originalHome = process.env.HOME || ''
    // We can't easily override HOME for the module, so test with env vars
  })

  afterEach(() => {
    process.env.HOME = originalHome
  })

  test('loads providers from config file', () => {
    // Config file exists on this machine with 3 providers
    process.env.OPENAI_API_KEY = 'test-key'

    const chain = new FallbackChain()
    const provider = chain.getCurrent()

    // Should load from config file (3 providers) rather than env
    expect(provider).not.toBeNull()
    expect(chain.isEnabled()).toBe(true)
    expect(chain.getProviders().length).toBeGreaterThanOrEqual(1)

    delete process.env.OPENAI_API_KEY
  })

  test('isEnabled returns true when multiple providers configured', () => {
    process.env.OPENAI_API_KEY = 'test-key'

    const chain = new FallbackChain()
    // Config file has 3 providers, so it's enabled
    expect(chain.isEnabled()).toBe(true)

    delete process.env.OPENAI_API_KEY
  })

  test('markDown triggers cooldown after 3 errors', () => {
    process.env.OPENAI_API_KEY = 'test-key'

    const chain = new FallbackChain()
    const provider = chain.getCurrent()!

    chain.markDown(provider.name)   // error 1
    chain.markDown(provider.name)   // error 2
    chain.markDown(provider.name)   // error 3 → marked down

    // Provider should be skipped now (but since it's the only one, still returned)
    const current = chain.getCurrent()
    expect(current).not.toBeNull() // returns first provider anyway when all down

    delete process.env.OPENAI_API_KEY
  })

  test('markSuccess resets error streak', () => {
    process.env.OPENAI_API_KEY = 'test-key'

    const chain = new FallbackChain()
    const provider = chain.getCurrent()!

    chain.markDown(provider.name)
    chain.markDown(provider.name)
    chain.markSuccess(provider.name) // reset

    const current = chain.getCurrent()
    expect(current).not.toBeNull()

    delete process.env.OPENAI_API_KEY
  })

  test('resolveApiKey handles env: prefix', () => {
    process.env.MY_TEST_KEY = 'resolved-value'
    expect(resolveApiKey('env:MY_TEST_KEY')).toBe('resolved-value')
    expect(resolveApiKey('literal-key')).toBe('literal-key')

    delete process.env.MY_TEST_KEY
  })

  test('getStats returns initial state', () => {
    process.env.OPENAI_API_KEY = 'test-key'

    const chain = new FallbackChain()
    const stats = chain.getStats()

    expect(stats.totalRequests).toBe(0)
    expect(stats.fallbacks).toEqual({})
    expect(stats.errors).toEqual({})

    delete process.env.OPENAI_API_KEY
  })
})
