/**
 * FreeClaude v3 — Cost Calculator Tests
 */

import { describe, expect, test } from 'bun:test'
import { calculateCost, calculateCostFromUsage, getPricing, formatCost } from './costCalculator.ts'

describe('getPricing', () => {
  test('returns $0 for free providers', () => {
    expect(getPricing('zai').promptPricePer1M).toBe(0)
    expect(getPricing('ollama').promptPricePer1M).toBe(0)
    expect(getPricing('gemini').promptPricePer1M).toBe(0)
  })

  test('matches provider by prefix', () => {
    expect(getPricing('zai-something').promptPricePer1M).toBe(0)
    expect(getPricing('openai-gpt4').promptPricePer1M).toBe(2.5)
  })

  test('returns $0 for unknown providers', () => {
    const pricing = getPricing('unknown-provider')
    expect(pricing.promptPricePer1M).toBe(0)
    expect(pricing.completionPricePer1M).toBe(0)
  })
})

describe('calculateCost', () => {
  test('returns 0 for free providers', () => {
    expect(calculateCost('zai', 1000, 500)).toBe(0)
    expect(calculateCost('ollama', 1000000, 1000000)).toBe(0)
  })

  test('calculates paid provider cost correctly', () => {
    // openai: $2.5/1M prompt, $10/1M completion
    const cost = calculateCost('openai', 1000000, 1000000)
    expect(cost).toBe(12.5)
  })

  test('handles zero tokens', () => {
    expect(calculateCost('openai', 0, 0)).toBe(0)
    expect(calculateCost('zai', 0, 0)).toBe(0)
  })
})

describe('calculateCostFromUsage', () => {
  test('parses OpenAI-style usage', () => {
    const result = calculateCostFromUsage('zai', {
      prompt_tokens: 100,
      completion_tokens: 50,
    })
    expect(result.promptTokens).toBe(100)
    expect(result.completionTokens).toBe(50)
    expect(result.costUsd).toBe(0) // zai is free
  })

  test('derives completion from total when missing', () => {
    const result = calculateCostFromUsage('openai', {
      prompt_tokens: 100,
      total_tokens: 250,
    })
    expect(result.promptTokens).toBe(100)
    expect(result.completionTokens).toBe(150)
  })

  test('handles empty usage', () => {
    const result = calculateCostFromUsage('zai', {})
    expect(result.promptTokens).toBe(0)
    expect(result.completionTokens).toBe(0)
    expect(result.costUsd).toBe(0)
  })
})

describe('formatCost', () => {
  test('formats free cost', () => {
    expect(formatCost(0)).toBe('$0.0000 (free)')
  })

  test('formats small cost', () => {
    expect(formatCost(0.001)).toBe('$0.0010')
  })

  test('formats medium cost', () => {
    expect(formatCost(0.05)).toBe('$0.05')
  })

  test('formats large cost', () => {
    expect(formatCost(1.5)).toBe('$1.50')
  })
})
