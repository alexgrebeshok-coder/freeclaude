import { describe, expect, test } from 'bun:test'
import {
  FallbackChain,
  shouldFallback,
  isNetworkError,
  describeProviderError,
} from '../src/services/api/fallbackChain.js'

describe('Integration: fallback chain flow', () => {
  test('network error triggers fallback to next provider', () => {
    const networkErr = new Error('fetch failed')
    expect(isNetworkError(networkErr)).toBe(true)
    expect(shouldFallback(0, networkErr)).toBe(true)
  })

  test('429 triggers fallback', () => {
    expect(shouldFallback(429)).toBe(true)
  })

  test('401 triggers fallback (auth failure at one provider)', () => {
    expect(shouldFallback(401)).toBe(true)
  })

  test('5xx triggers fallback', () => {
    expect(shouldFallback(500)).toBe(true)
    expect(shouldFallback(502)).toBe(true)
    expect(shouldFallback(503)).toBe(true)
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

  test('FallbackChain can be created with provider list', () => {
    const chain = new FallbackChain([
      { name: 'primary', baseUrl: 'http://localhost:1111/v1', apiKey: 'key1', models: ['model-a'] },
    ])
    const providers = chain.getProviderHealth()
    expect(providers.length).toBeGreaterThanOrEqual(1)
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
