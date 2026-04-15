import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Agent Bridge', () => {
  const TEST_DIR = join(tmpdir(), `agent-bridge-test-${Date.now()}`)
  const configPath = join(TEST_DIR, 'freeclaude.json')

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    process.env.FREECLAUDE_CONFIG_PATH = configPath
  })

  afterEach(() => {
    delete process.env.FREECLAUDE_CONFIG_PATH
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_API_KEY
    delete process.env.FREECLAUDE_PROVIDER
    delete process.env.FREECLAUDE_MODEL
    delete process.env.OPENAI_MODEL
    try {
      rmSync(TEST_DIR, { recursive: true, force: true })
    } catch {}
  })

  test('reads provider config from env vars', async () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.FREECLAUDE_PROVIDER = 'ollama'
    process.env.FREECLAUDE_MODEL = 'qwen3'

    const { getAgentProviderConfig } = await import('./agentBridge.ts')
    const config = getAgentProviderConfig()

    expect(config).not.toBeNull()
    expect(config!.provider).toBe('ollama')
    expect(config!.model).toBe('qwen3')
    expect(config!.baseUrl).toBe('http://localhost:11434/v1')
    expect(config!.apiKey).toBe('test-key')
  })

  test('reads provider config from file', async () => {
    writeFileSync(configPath, JSON.stringify({
      activeProvider: 0,
      providers: [{
        name: 'zai',
        baseUrl: 'https://api.z.ai/v1',
        apiKey: 'zai-key',
        model: 'gemma-3',
      }],
    }), 'utf-8')

    const { getAgentProviderConfig } = await import('./agentBridge.ts')
    const config = getAgentProviderConfig()

    expect(config).not.toBeNull()
    expect(config!.provider).toBe('zai')
    expect(config!.baseUrl).toBe('https://api.z.ai/v1')
  })

  test('buildAgentEnv sets required env vars', async () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    process.env.OPENAI_API_KEY = 'key'

    const { buildAgentEnv } = await import('./agentBridge.ts')
    const env = buildAgentEnv()

    expect(env.OPENAI_BASE_URL).toBe('http://localhost:11434/v1')
    expect(env.OPENAI_API_KEY).toBe('key')
    expect(env.CLAUDE_CODE_AGENT_MODE).toBe('1')
  })

  test('verifyAgentReadiness reports issues', async () => {
    // No config set
    const { verifyAgentReadiness } = await import('./agentBridge.ts')
    const result = verifyAgentReadiness()

    expect(result.ready).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  test('verifyAgentReadiness succeeds with full config', async () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1'
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.FREECLAUDE_MODEL = 'qwen3'

    // Import fresh — the function reads env on each call
    const mod = await import('./agentBridge.ts')
    const result = mod.verifyAgentReadiness()

    // With env vars set, config should be found
    expect(result.config).not.toBeNull()
    expect(result.config!.baseUrl).toBe('http://localhost:11434/v1')
    expect(result.config!.apiKey).toBe('test-key')
  })
})
