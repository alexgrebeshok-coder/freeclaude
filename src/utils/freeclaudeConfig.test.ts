import { describe, expect, test } from 'bun:test'
import {
  getFreeClaudeConfigPath,
  getOrderedConfiguredProviders,
  normalizeFreeClaudeConfig,
  parseProviderQualifiedModel,
  resolveConfiguredProviderModel,
} from './freeclaudeConfig.ts'

describe('freeclaudeConfig', () => {
  test('getFreeClaudeConfigPath honors FREECLAUDE_CONFIG_PATH override', () => {
    const previous = process.env.FREECLAUDE_CONFIG_PATH
    process.env.FREECLAUDE_CONFIG_PATH = '/tmp/freeclaude-config-test.json'

    try {
      expect(getFreeClaudeConfigPath()).toBe('/tmp/freeclaude-config-test.json')
    } finally {
      if (previous === undefined) {
        delete process.env.FREECLAUDE_CONFIG_PATH
      } else {
        process.env.FREECLAUDE_CONFIG_PATH = previous
      }
    }
  })

  test('resolveConfiguredProviderModel maps numeric selections for known providers', () => {
    expect(
      resolveConfiguredProviderModel(
        {
          name: 'zai',
          baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        },
        '2',
      ),
    ).toBe('glm-4.7-flash')

    expect(
      resolveConfiguredProviderModel(
        {
          name: 'openai',
          baseUrl: 'https://api.openai.com/v1',
        },
        '3',
      ),
    ).toBe('o3-mini')
  })

  test('normalizeFreeClaudeConfig repairs numeric provider and active models', () => {
    const normalized = normalizeFreeClaudeConfig({
      providers: [
        {
          name: 'zai',
          baseUrl: 'https://api.z.ai/api/coding/paas/v4',
          apiKey: 'test-key',
          model: '2',
          priority: 1,
          timeout: 30_000,
        },
      ],
      activeProvider: 'zai',
      activeModel: '2',
    })

    expect(normalized.changed).toBe(true)
    expect(normalized.config.providers?.[0]?.model).toBe('glm-4.7-flash')
    expect(normalized.config.activeModel).toBe('glm-4.7-flash')
  })

  test('getOrderedConfiguredProviders honors active provider and model override', () => {
    const providers = getOrderedConfiguredProviders({
      providers: [
        {
          name: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'openai-key',
          model: 'gpt-4o',
          priority: 1,
          timeout: 30_000,
        },
        {
          name: 'zai',
          baseUrl: 'https://api.z.ai/api/coding/paas/v4',
          apiKey: 'zai-key',
          model: 'glm-5',
          priority: 2,
          timeout: 30_000,
        },
      ],
      activeProvider: 'zai',
      activeModel: '2',
    })

    expect(providers[0]?.name).toBe('zai')
    expect(providers[0]?.model).toBe('glm-4.7-flash')
    expect(providers[1]?.name).toBe('openai')
  })

  test('unknown providers keep explicit numeric model ids untouched', () => {
    const normalized = normalizeFreeClaudeConfig({
      providers: [
        {
          name: 'custom-lab',
          baseUrl: 'https://models.example.com/v1',
          apiKey: 'test-key',
          model: '2',
          priority: 1,
          timeout: 30_000,
        },
      ],
    })

    expect(normalized.changed).toBe(false)
    expect(normalized.config.providers?.[0]?.model).toBe('2')
  })

  test('parseProviderQualifiedModel strips configured provider prefix', () => {
    expect(
      parseProviderQualifiedModel('zai/glm-4.7-flash', [
        {
          name: 'zai',
          baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        },
      ]),
    ).toEqual({
      providerName: 'zai',
      model: 'glm-4.7-flash',
    })
  })

  test('parseProviderQualifiedModel preserves router-style model ids when provider is not configured', () => {
    expect(parseProviderQualifiedModel('anthropic/claude-sonnet-4')).toEqual({
      model: 'anthropic/claude-sonnet-4',
    })
  })
})
