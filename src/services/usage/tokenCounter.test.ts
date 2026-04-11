/**
 * FreeClaude v3 — Token Counter Tests
 */

import { describe, expect, test } from 'bun:test'
import { estimateTokens, parseApiUsage, countTokens } from './tokenCounter.ts'

describe('estimateTokens', () => {
  test('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  test('estimates ~4 chars per token', () => {
    const text = 'a'.repeat(400)
    expect(estimateTokens(text)).toBe(100)
  })

  test('rounds up partial tokens', () => {
    expect(estimateTokens('abc')).toBe(1) // 3 chars → ceil(3/4) = 1
  })
})

describe('parseApiUsage', () => {
  test('parses standard OpenAI usage', () => {
    const result = parseApiUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
    })
    expect(result).not.toBeNull()
    expect(result!.promptTokens).toBe(100)
    expect(result!.completionTokens).toBe(50)
    expect(result!.totalTokens).toBe(150)
  })

  test('derives completion from total', () => {
    const result = parseApiUsage({
      prompt_tokens: 100,
      total_tokens: 250,
    })
    expect(result!.promptTokens).toBe(100)
    expect(result!.completionTokens).toBe(150)
  })

  test('returns null for undefined', () => {
    expect(parseApiUsage(undefined)).toBeNull()
  })

  test('returns null for zero tokens', () => {
    expect(parseApiUsage({})).toBeNull()
  })
})

describe('countTokens', () => {
  test('counts prompt and completion', () => {
    const result = countTokens('hello world', 'response')
    expect(result.promptTokens).toBe(3) // 11/4 = ceil(2.75) = 3
    expect(result.completionTokens).toBe(2) // 8/4 = 2
    expect(result.totalTokens).toBe(5)
  })
})
