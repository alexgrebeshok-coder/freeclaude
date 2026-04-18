import { describe, expect, test } from 'bun:test'
import {
  FallbackChain,
  shouldFallback,
  isNetworkError,
  describeProviderError,
  type ProviderConfig,
} from '../src/services/api/fallbackChain.js'

// Test providers — injected directly, no filesystem dependency
const testProviders: ProviderConfig[] = [
  { name: 'primary',   baseUrl: 'https://api.primary.ai/v1',   apiKey: 'key-1', model: 'model-a', priority: 1, timeout: 30000 },
  { name: 'secondary', baseUrl: 'https://api.secondary.ai/v1', apiKey: 'key-2', model: 'model-b', priority: 2, timeout: 30000 },
  { name: 'tertiary',  baseUrl: 'https://api.tertiary.ai/v1',  apiKey: 'key-3', model: 'model-c', priority: 3, timeout: 30000 },
]

describe('Integration: fallback helper functions', () => {
  test('network error triggers fallback', () => {
    const networkErr = new Error('fetch failed')
    expect(isNetworkError(networkErr)).toBe(true)
    expect(shouldFallback(0, networkErr)).toBe(true)
  })

  test('HTTP 429/401/5xx trigger fallback', () => {
    expect(shouldFallback(429)).toBe(true)
    expect(shouldFallback(401)).toBe(true)
    expect(shouldFallback(500)).toBe(true)
    expect(shouldFallback(502)).toBe(true)
    expect(shouldFallback(503)).toBe(true)
  })

  test('HTTP 200/404 do NOT trigger fallback', () => {
    expect(shouldFallback(200)).toBe(false)
    expect(shouldFallback(404)).toBe(false)
  })

  test('describeProviderError formats network errors', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    expect(describeProviderError(err, 0)).toBe('network error (ECONNREFUSED)')
  })

  test('describeProviderError formats HTTP status codes', () => {
    expect(describeProviderError(undefined, 401)).toBe('HTTP 401 authentication failed')
    expect(describeProviderError(undefined, 429)).toBe('HTTP 429 rate limited')
    expect(describeProviderError(undefined, 500)).toBe('HTTP 500 server error')
  })
})

describe('Integration: FallbackChain with injected providers', () => {
  test('constructs with injected providers (no filesystem)', () => {
    const chain = new FallbackChain(testProviders)
    expect(chain.getProviders()).toHaveLength(3)
    expect(chain.isEnabled()).toBe(true)
  })

  test('getCurrent returns highest-priority provider', () => {
    const chain = new FallbackChain(testProviders)
    const current = chain.getCurrent()
    expect(current).not.toBeNull()
    expect(current!.name).toBe('primary')
  })

  test('getNext returns next provider after failure', () => {
    const chain = new FallbackChain(testProviders)
    const next = chain.getNext('primary')
    expect(next).not.toBeNull()
    expect(next!.name).toBe('secondary')
  })

  test('markDown after 3 errors deprioritizes provider, getNext skips it', () => {
    const chain = new FallbackChain(testProviders)

    // 3 consecutive errors → marked down
    chain.markDown('primary')
    chain.markDown('primary')
    chain.markDown('primary')

    const current = chain.getCurrent()
    expect(current!.name).not.toBe('primary') // primary is down
  })

  test('markSuccess resets error streak', () => {
    const chain = new FallbackChain(testProviders)

    chain.markDown('primary')
    chain.markDown('primary')
    chain.markSuccess('primary') // reset before 3rd error

    const current = chain.getCurrent()
    expect(current!.name).toBe('primary') // still healthy
  })

  test('single provider chain: isEnabled is false', () => {
    const chain = new FallbackChain([testProviders[0]])
    expect(chain.isEnabled()).toBe(false)
    expect(chain.getCurrent()!.name).toBe('primary')
  })

  test('empty provider chain: getCurrent returns null', () => {
    const chain = new FallbackChain([])
    expect(chain.getCurrent()).toBeNull()
    expect(chain.isEnabled()).toBe(false)
  })

  test('stats track errors and fallbacks', () => {
    const chain = new FallbackChain(testProviders)

    chain.markDown('primary')
    chain.getNext('primary') // triggers fallback stat

    const stats = chain.getStats()
    expect(stats.errors['primary']).toBe(1)
    expect(stats.totalRequests).toBe(1)
  })
})

describe('Integration: typed errors', () => {
  test('FreeclaudeError hierarchy', async () => {
    const { 
      FreeclaudeError,
      AuthenticationError,
      RateLimitError,
      NetworkError,
      AllProvidersExhaustedError,
      AgentNestingError,
    } = await import('../src/services/api/freeclaudeErrors.js')

    const authErr = new AuthenticationError('openrouter')
    expect(authErr).toBeInstanceOf(FreeclaudeError)
    expect(authErr.category).toBe('authentication')
    expect(authErr.recoverable).toBe(false)
    expect(authErr.suggestions.length).toBeGreaterThan(0)

    const rateErr = new RateLimitError('openrouter', 30000)
    expect(rateErr).toBeInstanceOf(FreeclaudeError)
    expect(rateErr.recoverable).toBe(true)
    expect(rateErr.message).toContain('30s')

    const netErr = new NetworkError('ollama', 'ECONNREFUSED')
    expect(netErr.category).toBe('network')
    expect(netErr.message).toContain('ECONNREFUSED')

    const exhaustedErr = new AllProvidersExhaustedError([
      { provider: 'a', model: 'm1', error: 'HTTP 401' },
      { provider: 'b', model: 'm2', error: 'network error' },
    ])
    expect(exhaustedErr.failures).toHaveLength(2)
    expect(exhaustedErr.message).toContain('2 providers failed')

    const nestErr = new AgentNestingError('coder', 5, 5)
    expect(nestErr.message).toContain('5/5')
  })
})
