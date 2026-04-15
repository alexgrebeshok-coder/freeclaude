import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call } from './model.ts'

const ORIGINAL_ENV = {
  FREECLAUDE_CONFIG_PATH: process.env.FREECLAUDE_CONFIG_PATH,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
}

let tempDir = ''
let configPath = ''

function writeConfig(config: unknown): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
}

describe('/model command', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'freeclaude-model-'))
    configPath = join(tempDir, 'config.json')
    process.env.FREECLAUDE_CONFIG_PATH = configPath
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_MODEL
  })

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true })

    if (ORIGINAL_ENV.FREECLAUDE_CONFIG_PATH === undefined) {
      delete process.env.FREECLAUDE_CONFIG_PATH
    } else {
      process.env.FREECLAUDE_CONFIG_PATH = ORIGINAL_ENV.FREECLAUDE_CONFIG_PATH
    }

    if (ORIGINAL_ENV.OPENAI_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = ORIGINAL_ENV.OPENAI_API_KEY
    }

    if (ORIGINAL_ENV.OPENAI_BASE_URL === undefined) {
      delete process.env.OPENAI_BASE_URL
    } else {
      process.env.OPENAI_BASE_URL = ORIGINAL_ENV.OPENAI_BASE_URL
    }

    if (ORIGINAL_ENV.OPENAI_MODEL === undefined) {
      delete process.env.OPENAI_MODEL
    } else {
      process.env.OPENAI_MODEL = ORIGINAL_ENV.OPENAI_MODEL
    }
  })

  test('/model 1 repairs numeric model ids and persists the real provider model', async () => {
    writeConfig({
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

    const result = await call('1')
    expect(result.value).toContain('Model: glm-4.7-flash')
    expect(process.env.OPENAI_MODEL).toBe('glm-4.7-flash')

    const saved = readConfig()
    const providers = saved.providers as Array<{ model: string }>
    expect(providers[0]?.model).toBe('glm-4.7-flash')
    expect(saved.activeModel).toBe('glm-4.7-flash')
  })

  test('/model provider/model supports slashed model ids', async () => {
    writeConfig({
      providers: [
        {
          name: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'test-key',
          model: 'anthropic/claude-sonnet-4',
          priority: 1,
          timeout: 30_000,
        },
      ],
    })

    const result = await call('openrouter/google/gemini-2.5-flash')
    expect(result.value).toContain(
      'anthropic/claude-sonnet-4 → google/gemini-2.5-flash',
    )

    const saved = readConfig()
    const providers = saved.providers as Array<{ model: string }>
    expect(providers[0]?.model).toBe('google/gemini-2.5-flash')
  })

  test('/model provider index resolves known provider model lists', async () => {
    writeConfig({
      providers: [
        {
          name: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'test-key',
          model: 'gemini-2.5-flash',
          priority: 1,
          timeout: 30_000,
        },
      ],
    })

    const result = await call('gemini 2')
    expect(result.value).toContain('gemini-2.5-flash → gemini-2.5-pro')

    const saved = readConfig()
    const providers = saved.providers as Array<{ model: string }>
    expect(providers[0]?.model).toBe('gemini-2.5-pro')
    expect(process.env.OPENAI_MODEL).toBe('gemini-2.5-pro')
  })
})
