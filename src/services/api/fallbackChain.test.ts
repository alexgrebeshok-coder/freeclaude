/**
 * FreeClaude v3 — Fallback Chain Tests
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  FallbackChain,
  classifyRoutingGoal,
  shouldFallback,
  isNetworkError,
  resolveApiKey,
} from './fallbackChain.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ORIGINAL_FREECLAUDE_CONFIG_PATH = process.env.FREECLAUDE_CONFIG_PATH
const ORIGINAL_OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const ORIGINAL_OPENROUTER_MODEL = process.env.OPENROUTER_MODEL
const ORIGINAL_PREFER_ENV_OPENROUTER = process.env.FREECLAUDE_PREFER_ENV_OPENROUTER
let testConfigDir = ''
let testConfigPath = ''

beforeEach(() => {
  testConfigDir = mkdtempSync(join(tmpdir(), 'freeclaude-fallback-'))
  testConfigPath = join(testConfigDir, 'config.json')
  process.env.FREECLAUDE_CONFIG_PATH = testConfigPath
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_MODEL
  delete process.env.FREECLAUDE_PREFER_ENV_OPENROUTER

  // Ensure a test config exists so FallbackChain always has providers
  writeFileSync(testConfigPath, JSON.stringify({
    providers: [
      { name: 'test-openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'test-key', model: 'gpt-4o', priority: 1 },
      { name: 'test-zai', baseUrl: 'https://openai.api2d.net/v1', apiKey: 'test-key', model: 'glm-5-turbo', priority: 2 },
    ],
    enabled: true,
  }))
})

afterEach(() => {
  rmSync(testConfigDir, { force: true, recursive: true })
  if (ORIGINAL_FREECLAUDE_CONFIG_PATH === undefined) {
    delete process.env.FREECLAUDE_CONFIG_PATH
  } else {
    process.env.FREECLAUDE_CONFIG_PATH = ORIGINAL_FREECLAUDE_CONFIG_PATH
  }

  if (ORIGINAL_OPENROUTER_API_KEY === undefined) {
    delete process.env.OPENROUTER_API_KEY
  } else {
    process.env.OPENROUTER_API_KEY = ORIGINAL_OPENROUTER_API_KEY
  }

  if (ORIGINAL_OPENROUTER_MODEL === undefined) {
    delete process.env.OPENROUTER_MODEL
  } else {
    process.env.OPENROUTER_MODEL = ORIGINAL_OPENROUTER_MODEL
  }

  if (ORIGINAL_PREFER_ENV_OPENROUTER === undefined) {
    delete process.env.FREECLAUDE_PREFER_ENV_OPENROUTER
  } else {
    process.env.FREECLAUDE_PREFER_ENV_OPENROUTER = ORIGINAL_PREFER_ENV_OPENROUTER
  }
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

  test('appends env-backed OpenRouter before local providers', () => {
    writeFileSync(testConfigPath, JSON.stringify({
      providers: [
        { name: 'zai', baseUrl: 'https://api.z.ai/api/coding/paas/v4', apiKey: 'test-key', model: 'glm-4.7-flash', priority: 1 },
        { name: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'qwen2.5:3b', priority: 2 },
      ],
    }))
    process.env.OPENROUTER_API_KEY = 'env-openrouter-key'
    delete process.env.OPENROUTER_MODEL

    const chain = new FallbackChain()
    const providers = chain.getProviders()

    expect(providers.map(provider => provider.name)).toEqual([
      'zai',
      'openrouter',
      'ollama',
    ])
    expect(providers[1]?.model).toBe('qwen/qwen3-coder-next')
  })

  test('uses OPENROUTER_MODEL when appending env-backed OpenRouter', () => {
    writeFileSync(testConfigPath, JSON.stringify({
      providers: [
        { name: 'zai', baseUrl: 'https://api.z.ai/api/coding/paas/v4', apiKey: 'test-key', model: 'glm-4.7-flash', priority: 1 },
      ],
    }))
    process.env.OPENROUTER_API_KEY = 'env-openrouter-key'
    process.env.OPENROUTER_MODEL = 'deepseek/deepseek-chat'

    const chain = new FallbackChain()
    const openrouter = chain.getProviders().find(provider => provider.name === 'openrouter')

    expect(openrouter?.model).toBe('deepseek/deepseek-chat')
  })

  test('prepends env-backed OpenRouter when explicitly preferred', () => {
    writeFileSync(testConfigPath, JSON.stringify({
      providers: [
        { name: 'zai', baseUrl: 'https://api.z.ai/api/coding/paas/v4', apiKey: 'test-key', model: 'glm-4.7-flash', priority: 1 },
        { name: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'qwen2.5:3b', priority: 2 },
      ],
    }))
    process.env.OPENROUTER_API_KEY = 'env-openrouter-key'
    process.env.FREECLAUDE_PREFER_ENV_OPENROUTER = '1'

    const chain = new FallbackChain()

    expect(chain.getProviders().map(provider => provider.name)).toEqual([
      'openrouter',
      'zai',
      'ollama',
    ])
  })

  test('getStats returns initial state', () => {
    const chain = new FallbackChain()
    const stats = chain.getStats()

    expect(stats.totalRequests).toBe(0)
    expect(stats.fallbacks).toEqual({})
    expect(stats.errors).toEqual({})
  })

  test('classifies coding vs analysis prompts', () => {
    expect(classifyRoutingGoal('Fix TypeScript error in auth.ts')).toBe('coding')
    expect(
      classifyRoutingGoal('Analyze architecture tradeoffs and compare provider reliability'),
    ).toBe('analysis')
    expect(classifyRoutingGoal('Hi, quick question')).toBe('chat')
  })

  test('prefers reasoning model for analysis tasks', () => {
    writeFileSync(testConfigPath, JSON.stringify({
      providers: [
        { name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'test-key', model: 'gpt-4o', priority: 0 },
        { name: 'zai', baseUrl: 'https://api.z.ai/api/coding/paas/v4', apiKey: 'test-key', model: 'glm-5', priority: 1 },
      ],
    }))

    const chain = new FallbackChain()
    expect(chain.getCurrent('analysis')?.name).toBe('zai')
  })

  test('prefers fast local model for chat tasks', () => {
    writeFileSync(testConfigPath, JSON.stringify({
      providers: [
        { name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'test-key', model: 'moonshotai/kimi-k2.5', priority: 0 },
        { name: 'zai', baseUrl: 'https://api.z.ai/api/coding/paas/v4', apiKey: 'test-key', model: 'glm-5', priority: 1 },
        { name: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'qwen2.5:3b', priority: 2 },
      ],
    }))

    const chain = new FallbackChain()
    expect(chain.getCurrent('chat')?.name).toBe('ollama')
  })
})
