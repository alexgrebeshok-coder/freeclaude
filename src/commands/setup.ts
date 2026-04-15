#!/usr/bin/env node
/**
 * FreeClaude v2 — Provider Setup Wizard
 * Usage: node src/commands/setup.ts
 *
 * Interactive setup for adding providers to ~/.freeclaude.json
 */

import * as readline from 'node:readline'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  getFreeClaudeConfigPath,
  resolveConfiguredProviderModel,
} from '../utils/freeclaudeConfig.ts'

// Provider presets
const PRESETS: Record<string, {
  baseUrl: string
  model: string
  apiKeyHint: string
  free: boolean
}> = {
  zai: {
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    model: 'glm-4.7-flash',
    apiKeyHint: 'ZAI API key (free for RF)',
    free: true,
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:3b',
    apiKeyHint: 'Any value (e.g., "ollama")',
    free: true,
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash-lite',
    apiKeyHint: 'Google AI API key (free tier: 15 RPM)',
    free: true,
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiKeyHint: 'OpenAI API key ($2.50/1M tokens)',
    free: false,
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKeyHint: 'DeepSeek API key ($0.14/1M tokens)',
    free: false,
  },
  custom: {
    baseUrl: '',
    model: '',
    apiKeyHint: 'API key',
    free: false,
  },
}

interface ProviderConfig {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  priority: number
  timeout: number
}

interface FreeClaudeConfig {
  providers: ProviderConfig[]
  defaults: {
    maxRetries: number
    retryDelay: number
    logLevel: string
  }
}

// ---- Readline helpers ----

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function question(prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve))
}

// ---- Config I/O ----

function loadConfig(): FreeClaudeConfig {
  const configPath = getFreeClaudeConfigPath()
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch {
      // Corrupted config, start fresh
    }
  }
  return {
    providers: [],
    defaults: { maxRetries: 3, retryDelay: 1000, logLevel: 'info' },
  }
}

function saveConfig(config: FreeClaudeConfig): void {
  writeFileSync(getFreeClaudeConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

// ---- Provider test ----

async function testProvider(provider: ProviderConfig): Promise<{ ok: boolean; time: number; error?: string }> {
  const start = Date.now()
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(provider.timeout || 15000),
    })

    const time = Date.now() - start

    if (!response.ok) {
      const body = await response.text().catch(() => 'unknown')
      return { ok: false, time, error: `${response.status}: ${body.slice(0, 100)}` }
    }

    return { ok: true, time }
  } catch (e) {
    return { ok: false, time: Date.now() - start, error: (e as Error).message }
  }
}

// ---- Main ----

async function main() {
  console.log('\n🔧 FreeClaude v2 — Provider Setup Wizard\n')

  const config = loadConfig()
  const existingCount = config.providers.length

  if (existingCount > 0) {
    console.log('Current providers:')
    for (const p of config.providers) {
      console.log(`  ${p.priority}. ${p.name} (${p.model}) — ${p.baseUrl}`)
    }
    console.log()
  }

  // Select provider type
  console.log('Select provider to add:')
  console.log('  1. ZAI (free for RF) 🇷🇺')
  console.log('  2. Ollama (local, free) 🏠')
  console.log('  3. Gemini (free tier) 🌐')
  console.log('  4. OpenAI ($2.50/1M tokens)')
  console.log('  5. DeepSeek ($0.14/1M tokens)')
  console.log('  6. Custom OpenAI-compatible')
  console.log()

  const choice = await question('> ')
  const presetKey = ['zai', 'ollama', 'gemini', 'openai', 'deepseek', 'custom'][parseInt(choice) - 1]

  if (!presetKey || !PRESETS[presetKey]) {
    console.log('❌ Invalid choice')
    rl.close()
    process.exit(1)
  }

  const preset = PRESETS[presetKey]

  // Name
  const name = await question(`Provider name [${presetKey}]: `) || presetKey

  // Check duplicate
  if (config.providers.some(p => p.name === name)) {
    const overwrite = await question(`Provider "${name}" already exists. Overwrite? [y/N]: `)
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Cancelled.')
      rl.close()
      process.exit(0)
    }
    config.providers = config.providers.filter(p => p.name !== name)
  }

  // Base URL
  const baseUrl = await question(`Base URL [${preset.baseUrl}]: `) || preset.baseUrl

  // API Key
  console.log(`  ${preset.apiKeyHint}`)
  const apiKeyInput = await question('API key (or env:VAR_NAME): ')
  const apiKey = apiKeyInput || 'ollama'

  // Model
  const modelInput = await question(`Model [${preset.model}]: `)
  const model =
    resolveConfiguredProviderModel(
      { name, baseUrl },
      modelInput || preset.model,
    ) ?? preset.model

  // Priority
  const nextPriority = config.providers.length > 0
    ? Math.max(...config.providers.map(p => p.priority)) + 1
    : 1
  const priorityInput = await question(`Priority [${nextPriority}]: `)
  const priority = parseInt(priorityInput) || nextPriority

  // Timeout
  const timeoutInput = await question(`Timeout ms [30000]: `)
  const timeout = parseInt(timeoutInput) || 30000

  // Build provider
  const provider: ProviderConfig = { name, baseUrl, apiKey, model, priority, timeout }

  // Test connection
  console.log(`\n🧪 Testing ${name}...`)
  const test = await testProvider(provider)

  if (test.ok) {
    console.log(`✅ ${name} is working! (${test.time}ms)`)
  } else {
    console.log(`⚠️  ${name} test failed: ${test.error}`)
    console.log('   Adding anyway — you can fix later in ~/.freeclaude.json')
  }

  // Add to config
  config.providers.push(provider)
  config.providers.sort((a, b) => a.priority - b.priority)
  saveConfig(config)

  console.log(`\n✅ Saved to ${getFreeClaudeConfigPath()}`)
  console.log(`\nProviders configured: ${config.providers.length}`)
  for (const p of config.providers) {
    console.log(`  ${p.priority}. ${p.name} (${p.model})`)
  }

  const addMore = await question('\nAdd another provider? [y/N]: ')
  if (addMore.toLowerCase() === 'y') {
    console.log()
    await main() // Recursion for simplicity
    return
  }

  console.log('\n🎉 Setup complete! Run: fc "your task"\n')
  rl.close()
}

main().catch(e => {
  console.error('Error:', e)
  rl.close()
  process.exit(1)
})
