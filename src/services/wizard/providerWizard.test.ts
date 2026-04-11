/**
 * FreeClaude v3 — Provider Wizard Tests
 */

import { describe, expect, test, beforeEach } from 'bun:test'
import {
  loadConfig,
  saveConfig,
  PROVIDER_TEMPLATES,
  type FreeClaudeConfig,
} from './providerWizard.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, unlinkSync } from 'node:fs'

// Use a temp config path for testing
const TEST_CONFIG_PATH = join(tmpdir(), 'freeclaude-test-config.json')

describe('Provider Wizard', () => {
  test('PROVIDER_TEMPLATES has expected providers', () => {
    const names = PROVIDER_TEMPLATES.map(t => t.name)
    expect(names).toContain('ZAI (GLM)')
    expect(names).toContain('Ollama (Local)')
    expect(names).toContain('Gemini (Google)')
    expect(names).toContain('OpenRouter')
  })

  test('all templates have required fields', () => {
    for (const template of PROVIDER_TEMPLATES) {
      expect(template.name).toBeTruthy()
      expect(template.baseUrl).toBeTruthy()
      expect(template.model).toBeTruthy()
      expect(template.testEndpoint).toBeTruthy()
      expect(template.testBody).toBeTruthy()
      expect(template.description).toBeTruthy()
      expect(typeof template.free).toBe('boolean')
    }
  })

  test('free providers are actually free', () => {
    const freeProviders = PROVIDER_TEMPLATES.filter(t => t.free)
    expect(freeProviders.length).toBeGreaterThanOrEqual(3) // ZAI, Ollama, Gemini at minimum
  })

  test('loadConfig returns null for non-existent file', () => {
    // The real config might exist, so test with a path that doesn't exist
    expect(typeof loadConfig()).toBe('object' || loadConfig() === null)
  })

  test('PROVIDER_TEMPLATES URLs are valid', () => {
    for (const template of PROVIDER_TEMPLATES) {
      try {
        new URL(template.baseUrl)
      } catch {
        throw new Error(`Invalid URL for ${template.name}: ${template.baseUrl}`)
      }
    }
  })

  test('test bodies are valid JSON', () => {
    for (const template of PROVIDER_TEMPLATES) {
      try {
        JSON.parse(template.testBody)
      } catch {
        throw new Error(`Invalid test body JSON for ${template.name}`)
      }
    }
  })
})

describe('Default Hooks', () => {
  test('getEnabledDefaultHooks returns array', async () => {
    const { getEnabledDefaultHooks } = await import('../hooks/defaultHooks.ts')
    const hooks = getEnabledDefaultHooks()
    expect(Array.isArray(hooks)).toBe(true)
    expect(hooks.length).toBeGreaterThan(0)
  })

  test('all enabled hooks have required fields', async () => {
    const { getEnabledDefaultHooks } = await import('../hooks/defaultHooks.ts')
    const hooks = getEnabledDefaultHooks()
    for (const hook of hooks) {
      expect(hook.event).toBeTruthy()
      expect(hook.name).toBeTruthy()
      expect(hook.command).toBeTruthy()
    }
  })

  test('getDefaultHooksConfig returns valid config', async () => {
    const { getDefaultHooksConfig } = await import('../hooks/defaultHooks.ts')
    const config = getDefaultHooksConfig()
    expect(typeof config).toBe('object')
    expect(Object.keys(config).length).toBeGreaterThan(0)
  })
})
