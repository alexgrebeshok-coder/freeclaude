/**
 * FreeClaude — Fallback Audit Tests
 *
 * Integration tests asserting correct classification and action for every
 * transient failure class the fallback chain can encounter.
 * One test per important error scenario; uses injected providers so no real
 * network traffic is produced.
 */

import { describe, expect, test } from 'bun:test'
import {
  FallbackChain,
  shouldFallback,
  isNetworkError,
  isAbortError,
  parseRetryAfterMs,
  isStreamCutError,
  shouldCircuitOpen,
  isProviderRestrictionError,
} from './fallbackChain.ts'
import type { ProviderConfig } from './fallbackChain.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_A: ProviderConfig = {
  name: 'primary',
  baseUrl: 'https://api.primary.example',
  apiKey: 'key-a',
  model: 'test-model',
  priority: 1,
  timeout: 30000,
}

const PROVIDER_B: ProviderConfig = {
  name: 'secondary',
  baseUrl: 'https://api.secondary.example',
  apiKey: 'key-b',
  model: 'test-model',
  priority: 2,
  timeout: 30000,
}

function mkChain(): FallbackChain {
  return new FallbackChain([PROVIDER_A, PROVIDER_B])
}

// ---------------------------------------------------------------------------
// 1.  408 Request Timeout → retry-then-fallback
// ---------------------------------------------------------------------------
describe('408 Request Timeout', () => {
  test('shouldFallback returns true for 408', () => {
    expect(shouldFallback(408)).toBe(true)
  })

  test('FallbackChain: primary 408 → getNext returns secondary', () => {
    const chain = mkChain()
    // Mark primary down three times to open circuit
    chain.markDown(PROVIDER_A.name)
    chain.markDown(PROVIDER_A.name)
    chain.markDown(PROVIDER_A.name)

    const next = chain.getNext(PROVIDER_A.name)
    expect(next?.name).toBe('secondary')
  })
})

// ---------------------------------------------------------------------------
// 2.  425 Too Early → retry-then-fallback
// ---------------------------------------------------------------------------
describe('425 Too Early', () => {
  test('shouldFallback returns true for 425', () => {
    expect(shouldFallback(425)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3.  AbortError (user cancel) → must NOT trigger fallback
// ---------------------------------------------------------------------------
describe('AbortError — user cancellation', () => {
  test('isAbortError detects DOMException AbortError', () => {
    const err = new DOMException('The operation was aborted.', 'AbortError')
    expect(isAbortError(err)).toBe(true)
  })

  test('isAbortError detects plain Error with name=AbortError', () => {
    const err = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(isAbortError(err)).toBe(true)
  })

  test('shouldFallback returns false for AbortError (do not retry user cancel)', () => {
    const err = new DOMException('The operation was aborted.', 'AbortError')
    expect(shouldFallback(0, err)).toBe(false)
  })

  test('shouldFallback returns false for AbortError even with a 5xx status', () => {
    // If somehow a 503 arrives with an AbortError, user cancel takes priority.
    const err = new DOMException('aborted', 'AbortError')
    expect(shouldFallback(503, err)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4.  ETIMEDOUT — transient network timeout → fallback
// ---------------------------------------------------------------------------
describe('ETIMEDOUT — network timeout', () => {
  test('isNetworkError true for ETIMEDOUT', () => {
    expect(isNetworkError(new Error('connect ETIMEDOUT 1.2.3.4:443'))).toBe(true)
  })

  test('shouldFallback true for ETIMEDOUT (not user cancel)', () => {
    expect(shouldFallback(0, new Error('connect ETIMEDOUT'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5.  EAI_AGAIN — DNS temporary failure → fallback
// ---------------------------------------------------------------------------
describe('EAI_AGAIN — DNS temporary failure', () => {
  test('isNetworkError true for EAI_AGAIN', () => {
    expect(isNetworkError(new Error('getaddrinfo EAI_AGAIN api.provider.example'))).toBe(true)
  })

  test('shouldFallback true for EAI_AGAIN', () => {
    expect(shouldFallback(0, new Error('getaddrinfo EAI_AGAIN api.provider.example'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 6.  401 Unauthorized → fallback + circuit-open
// ---------------------------------------------------------------------------
describe('401 Unauthorized', () => {
  test('shouldFallback true for 401', () => {
    expect(shouldFallback(401)).toBe(true)
  })

  test('shouldCircuitOpen true for 401 (invalid/revoked key)', () => {
    expect(shouldCircuitOpen(401)).toBe(true)
  })

  test('FallbackChain: after shouldCircuitOpen on primary, secondary becomes current', () => {
    const chain = mkChain()
    // Simulate circuit-open: caller marks provider down three times
    if (shouldCircuitOpen(401)) {
      chain.markDown(PROVIDER_A.name)
      chain.markDown(PROVIDER_A.name)
      chain.markDown(PROVIDER_A.name)
    }
    const current = chain.getCurrent()
    expect(current?.name).toBe('secondary')
  })
})

// ---------------------------------------------------------------------------
// 7.  403 pure auth refusal → circuit-open (not TOS restriction)
// ---------------------------------------------------------------------------
describe('403 pure auth refusal', () => {
  test('shouldCircuitOpen true for plain 403', () => {
    expect(shouldCircuitOpen(403, new Error('forbidden'))).toBe(true)
  })

  test('shouldFallback true for plain 403', () => {
    expect(shouldFallback(403, new Error('forbidden'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 8.  403 geo/TOS restriction → fallback only, NOT circuit-open
// ---------------------------------------------------------------------------
describe('403 geo/TOS restriction', () => {
  const tosErr = new Error(
    'OpenAI API error 403: {"error":{"message":"The request is prohibited due to a violation of provider Terms Of Service."}}',
  )

  test('isProviderRestrictionError true', () => {
    expect(isProviderRestrictionError(tosErr)).toBe(true)
  })

  test('shouldFallback true for TOS restriction', () => {
    expect(shouldFallback(403, tosErr)).toBe(true)
  })

  test('shouldCircuitOpen false for TOS restriction (transient, not a bad key)', () => {
    expect(shouldCircuitOpen(403, tosErr)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 9.  429 Too Many Requests → fallback
// ---------------------------------------------------------------------------
describe('429 Too Many Requests', () => {
  test('shouldFallback true for 429', () => {
    expect(shouldFallback(429)).toBe(true)
  })

  test('shouldCircuitOpen false for 429 (rate-limit is transient)', () => {
    expect(shouldCircuitOpen(429)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 10. parseRetryAfterMs — numeric seconds
// ---------------------------------------------------------------------------
describe('parseRetryAfterMs — numeric seconds', () => {
  test('parses "30" → 30000 ms', () => {
    expect(parseRetryAfterMs({ 'retry-after': '30' })).toBe(30_000)
  })

  test('caps at maxWaitMs (default 60 s)', () => {
    expect(parseRetryAfterMs({ 'retry-after': '120' })).toBe(60_000)
  })

  test('respects custom maxWaitMs', () => {
    expect(parseRetryAfterMs({ 'retry-after': '120' }, 90_000)).toBe(90_000)
  })

  test('returns undefined when header absent', () => {
    expect(parseRetryAfterMs({})).toBeUndefined()
  })

  test('works with a Headers-like .get() interface', () => {
    const headers = { get: (name: string) => name === 'retry-after' ? '5' : null }
    expect(parseRetryAfterMs(headers)).toBe(5_000)
  })
})

// ---------------------------------------------------------------------------
// 11. parseRetryAfterMs — HTTP-date format
// ---------------------------------------------------------------------------
describe('parseRetryAfterMs — HTTP-date', () => {
  test('parses a future HTTP-date and returns positive ms (capped)', () => {
    const futureDate = new Date(Date.now() + 10_000).toUTCString()
    const result = parseRetryAfterMs({ 'Retry-After': futureDate }, 60_000)
    expect(result).toBeGreaterThan(0)
    expect(result!).toBeLessThanOrEqual(60_000)
  })

  test('past HTTP-date returns 0 (no wait needed)', () => {
    const pastDate = new Date(Date.now() - 5_000).toUTCString()
    expect(parseRetryAfterMs({ 'Retry-After': pastDate })).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 12. isStreamCutError — partial / truncated stream
// ---------------------------------------------------------------------------
describe('isStreamCutError', () => {
  test('detects "Unexpected end of JSON"', () => {
    expect(isStreamCutError(new Error('Unexpected end of JSON input'))).toBe(true)
  })

  test('detects "premature close"', () => {
    expect(isStreamCutError(new Error('premature close'))).toBe(true)
  })

  test('detects "Unexpected end of stream"', () => {
    expect(isStreamCutError(new Error('Unexpected end of stream'))).toBe(true)
  })

  test('does NOT match generic errors', () => {
    expect(isStreamCutError(new Error('connection refused'))).toBe(false)
    expect(isStreamCutError(new Error('unauthorized'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 13. FallbackChain: primary 5xx → secondary serves response (stats updated)
// ---------------------------------------------------------------------------
describe('FallbackChain 5xx fallback integration', () => {
  test('502 causes switch to secondary; fallback stats updated', () => {
    const chain = mkChain()
    expect(shouldFallback(502)).toBe(true)

    chain.markDown(PROVIDER_A.name)
    chain.markDown(PROVIDER_A.name)
    chain.markDown(PROVIDER_A.name)

    const next = chain.getNext(PROVIDER_A.name)
    expect(next?.name).toBe('secondary')

    const stats = chain.getStats()
    expect(stats.errors['primary']).toBe(3)
    expect(stats.fallbacks['secondary']).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// 14. ECONNREFUSED / ENOTFOUND — classic network errors
// ---------------------------------------------------------------------------
describe('Classic network errors', () => {
  test('ECONNREFUSED isNetworkError true', () => {
    expect(isNetworkError(new Error('connect ECONNREFUSED 127.0.0.1:8080'))).toBe(true)
  })

  test('ENOTFOUND isNetworkError true', () => {
    expect(isNetworkError(new Error('getaddrinfo ENOTFOUND api.example.com'))).toBe(true)
  })

  test('generic unknown error NOT network error', () => {
    expect(isNetworkError(new Error('something completely unexpected'))).toBe(false)
  })
})
