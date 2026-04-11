/**
 * FreeClaude v3 — Provider Wizard
 *
 * Interactive setup for configuring LLM providers.
 * Tests connectivity and generates ~/.freeclaude.json config.
 */

import { execSync, exec } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderTemplate {
  name: string
  baseUrl: string
  model: string
  apiKeyPrompt: string
  testEndpoint: string
  testBody: string
  description: string
  free: boolean
}

// ---------------------------------------------------------------------------
// Provider templates
// ---------------------------------------------------------------------------

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    name: 'ZAI (GLM)',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    model: 'glm-4.7-flash',
    apiKeyPrompt: 'ZAI API key (format: xxxxxxx.IonFMBpmLlTFf1U7)',
    testEndpoint: '/chat/completions',
    testBody: '{"model":"glm-4.7-flash","messages":[{"role":"user","content":"hi"}],"max_tokens":5}',
    description: 'Zhipu AI — GLM-4.7 Flash (free, 128K context)',
    free: true,
  },
  {
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:3b',
    apiKeyPrompt: 'Leave empty for local models',
    testEndpoint: '/chat/completions',
    testBody: '{"model":"qwen2.5:3b","messages":[{"role":"user","content":"hi"}],"max_tokens":5}',
    description: 'Ollama — local LLM (free, private, no API key)',
    free: true,
  },
  {
    name: 'Gemini (Google)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash-lite',
    apiKeyPrompt: 'Google AI API key (from aistudio.google.com)',
    testEndpoint: '/chat/completions',
    testBody: '{"model":"gemini-2.5-flash-lite","messages":[{"role":"user","content":"hi"}],"max_tokens":5}',
    description: 'Google Gemini Flash (free tier, 1M context)',
    free: true,
  },
  {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-r1:free',
    apiKeyPrompt: 'OpenRouter API key (from openrouter.ai)',
    testEndpoint: '/chat/completions',
    testBody: '{"model":"deepseek/deepseek-r1:free","messages":[{"role":"user","content":"hi"}],"max_tokens":5}',
    description: 'OpenRouter — access to many models (free options)',
    free: true,
  },
]

// ---------------------------------------------------------------------------
// Config file
// ---------------------------------------------------------------------------

const CONFIG_PATH = join(homedir(), '.freeclaude.json')

export interface FreeClaudeConfig {
  providers: Array<{
    name: string
    baseUrl: string
    apiKey: string
    model: string
    priority: number
    timeout: number
  }>
  defaults?: {
    maxRetries?: number
    retryDelay?: number
    logLevel?: string
  }
}

/**
 * Load existing config.
 */
export function loadConfig(): FreeClaudeConfig | null {
  if (!existsSync(CONFIG_PATH)) return null

  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Save config.
 */
export function saveConfig(config: FreeClaudeConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/**
 * Add a provider to config.
 */
export function addProvider(
  template: ProviderTemplate,
  apiKey: string,
  priority: number,
): FreeClaudeConfig {
  const config = loadConfig() || { providers: [] }

  // Check if provider with same name exists
  const existingIdx = config.providers.findIndex(p => p.name === template.name)
  const newProvider = {
    name: template.name,
    baseUrl: template.baseUrl,
    apiKey: apiKey || 'none',
    model: template.model,
    priority,
    timeout: 30000,
  }

  if (existingIdx >= 0) {
    config.providers[existingIdx] = newProvider
  } else {
    config.providers.push(newProvider)
    // Sort by priority
    config.providers.sort((a, b) => a.priority - b.priority)
  }

  saveConfig(config)
  return config
}

// ---------------------------------------------------------------------------
// Connectivity test
// ---------------------------------------------------------------------------

export interface TestResult {
  success: boolean
  latencyMs: number
  model: string
  error?: string
}

/**
 * Test a provider connection.
 */
export async function testProvider(
  template: ProviderTemplate,
  apiKey: string = '',
): Promise<TestResult> {
  const startTime = Date.now()
  const url = template.baseUrl + template.testEndpoint

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (apiKey && apiKey !== 'none') {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  return new Promise((resolve) => {
    const body = template.testBody
    const cmd = `curl -s --max-time 30 -X POST "${url}" \
      -H "Content-Type: application/json" \
      ${apiKey && apiKey !== 'none' ? `-H "Authorization: Bearer ${apiKey}"` : ''} \
      -d '${body}' 2>&1`

    exec(cmd, { timeout: 35000 }, (error, stdout) => {
      const latencyMs = Date.now() - startTime

      if (error) {
        resolve({
          success: false,
          latencyMs,
          model: template.model,
          error: error.message.slice(0, 100),
        })
        return
      }

      try {
        const data = JSON.parse(stdout)
        const hasContent = data.choices?.[0]?.message?.content ||
          data.choices?.[0]?.message?.reasoning_content

        if (hasContent || data.choices?.length > 0) {
          resolve({
            success: true,
            latencyMs,
            model: template.model,
          })
        } else {
          resolve({
            success: false,
            latencyMs,
            model: template.model,
            error: 'No response content',
          })
        }
      } catch {
        resolve({
          success: false,
          latencyMs,
          model: template.model,
          error: `Invalid response: ${stdout.slice(0, 50)}`,
        })
      }
    })
  })
}

/**
 * Run the full wizard (non-interactive, returns suggested config).
 */
export async function autoDetect(): Promise<{
  detected: Array<{ template: ProviderTemplate; test: TestResult }>
  config: FreeClaudeConfig
}> {
  const detected: Array<{ template: ProviderTemplate; test: TestResult }> = []

  for (const template of PROVIDER_TEMPLATES) {
    // For local providers, try without API key
    const apiKey = template.free && template.name.includes('Ollama') ? '' : ''

    // Quick check if endpoint is reachable
    try {
      const test = await testProvider(template, apiKey)
      if (test.success) {
        detected.push({ template, test })
      }
    } catch {
      // Provider not available, skip
    }
  }

  // Build config from detected providers
  const config: FreeClaudeConfig = {
    providers: detected.map((d, i) => ({
      name: d.template.name,
      baseUrl: d.template.baseUrl,
      apiKey: 'auto-detected',
      model: d.template.model,
      priority: i + 1,
      timeout: 30000,
    })),
    defaults: {
      maxRetries: 3,
      retryDelay: 1000,
      logLevel: 'info',
    },
  }

  return { detected, config }
}
