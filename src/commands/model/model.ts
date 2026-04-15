/**
 * FreeClaude v3 — /model Command
 *
 * Switch between configured providers and models.
 * Remembers last choice in config (activeProvider + activeModel).
 * Usage:
 *   /model              — show current provider and list available
 *   /model <number>     — switch to provider by number
 *   /model <name>       — switch to provider by name or model name
 *   /model add          — run setup wizard to add new provider
 */

import type { LocalCommandCall } from '../../types/command.js'
import {
  normalizeFreeClaudeConfig,
  readFreeClaudeConfig,
  resolveConfiguredProviderModel,
  type FreeClaudeConfig as Config,
  type FreeClaudeProviderConfig as Provider,
  writeFreeClaudeConfig,
} from '../../utils/freeclaudeConfig.ts'

function maskKey(key: string): string {
  if (!key || key.length < 8) return '••••'
  if (key.startsWith('env:')) return `env:••••`
  return key.slice(0, 4) + '••••' + key.slice(-4)
}

function loadConfig(): Config {
  const config = readFreeClaudeConfig() ?? { providers: [] }
  const normalized = normalizeFreeClaudeConfig(config)
  if (normalized.changed) {
    writeFreeClaudeConfig(normalized.config)
  }
  return normalized.config
}

function saveConfig(config: Config): void {
  writeFreeClaudeConfig(config)
}

export const call: LocalCommandCall = async (args) => {
  const config = loadConfig()
  const providers = config.providers ?? []
  const trimmed = args.trim()

  // /model add — print instructions (wizard runs outside bundle)
  if (trimmed === 'add' || trimmed === 'new' || trimmed === 'setup') {
    return {
      type: 'text' as const,
      value: [
        '  To add a new provider, run in your terminal:',
        '',
        '    freeclaude --setup',
        '',
        '  This will open the setup wizard where you can:',
        '    • Choose from 23 providers (free, local, paid)',
        '    • Enter API key or use env var',
        '    • Auto-detect Ollama/LM Studio models',
        '',
        '  After adding, restart FreeClaude or run /model to see the new provider.',
      ].join('\n'),
    }
  }

  if (providers.length === 0) {
    return {
      type: 'text' as const,
      value: [
        '🤖 No providers configured.',
        '',
        'Run /model add to add a provider.',
        'Or run `freeclaude --setup` in your terminal.',
      ].join('\n'),
    }
  }

  // Find current active
  const currentBase = process.env.OPENAI_BASE_URL || ''
  const currentModel = process.env.OPENAI_MODEL || ''
  let activeIdx = -1
  for (let i = 0; i < providers.length; i++) {
    if (providers[i]!.baseUrl === currentBase && providers[i]!.model === currentModel) {
      activeIdx = i
      break
    }
  }
  if (activeIdx < 0 && config.activeProvider) {
    activeIdx = providers.findIndex(provider => provider.name === config.activeProvider)
  }

  // Switch provider or model
  if (trimmed !== '') {
    const num = parseInt(trimmed)
    if (!isNaN(num) && num >= 1 && num <= providers.length) {
      return switchProvider(config, providers, num - 1)
    }

    const slashIdx = trimmed.indexOf('/')
    if (slashIdx > 0) {
      const providerPart = trimmed.slice(0, slashIdx).trim().toLowerCase()
      const modelPart = trimmed.slice(slashIdx + 1).trim()
      if (providerPart && modelPart) {
        let provMatch = providers.findIndex(
          provider => provider.name.toLowerCase() === providerPart,
        )
        if (provMatch < 0) {
          provMatch = providers.findIndex(provider =>
            provider.name.toLowerCase().includes(providerPart),
          )
        }
        if (provMatch >= 0) {
          return switchModel(config, providers, provMatch, modelPart)
        }
      }
    }

    // /model provider model-id — switch model within a provider
    // e.g. /model openrouter anthropic/claude-sonnet-4
    // e.g. /model openrouter google/gemini-2.5-flash
    // e.g. /model openrouter minimax/minimax-m2.5:free
    // First word = provider name, rest = model id
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 2) {
      const providerPart = parts[0]!.toLowerCase()
      const modelPart = parts.slice(1).join(' ')

      let provMatch = providers.findIndex(p => p.name.toLowerCase() === providerPart)
      if (provMatch < 0) {
        provMatch = providers.findIndex(p => p.name.toLowerCase().includes(providerPart))
      }
      if (provMatch >= 0) {
        return switchModel(config, providers, provMatch, modelPart)
      }
    }

    // Match by provider name
    const match = providers.findIndex(p => p.name.toLowerCase() === trimmed.toLowerCase())
    if (match >= 0) {
      return switchProvider(config, providers, match)
    }

    // Match by model name (partial)
    const modelMatch = providers.findIndex(p => p.model.toLowerCase().includes(trimmed.toLowerCase()))
    if (modelMatch >= 0) {
      return switchProvider(config, providers, modelMatch)
    }

    return {
      type: 'text' as const,
      value: `❌ Provider "${trimmed}" not found.\n\nRun /model to see available providers.\n\nTip: Use /model provider/model or /model provider model-id to change model within a provider.\nExample: /model openrouter/anthropic/claude-sonnet-4`,
    }
  }

  // Show list in config order
  const lines = ['🤖 Model & Provider Switcher', '']

  if (activeIdx >= 0) {
    const p = providers[activeIdx]!
    const url = p.baseUrl.replace(/https?:\/\//, '').replace(/\/api.*$/, '')
    lines.push(`  Active: ${p.name} — ${p.model}`)
    lines.push(`  Endpoint: ${url}`)
  } else {
    lines.push(`  Active: ${currentModel || 'default'}`)
  }

  lines.push('')
  lines.push('  Configured providers:')
  lines.push('')

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]!
    const active = i === activeIdx ? ' ◀' : ''
    lines.push(`  ${i + 1}) ${p.name} — ${p.model}${active}`)
  }

  lines.push('')
  lines.push('  Usage:')
  lines.push('    /model 1        Switch to #1')
  lines.push('    /model glm-5    Switch by model name')
  lines.push('    /model add      Add new provider')
  lines.push('    /providers test Test connectivity')

  return {
    type: 'text' as const,
    value: lines.join('\n'),
  }
}

function switchProvider(config: Config, providers: Provider[], idx: number): { type: 'text'; value: string } {
  const target = providers[idx]!

  // Update env vars immediately
  let apiKey = target.apiKey
  if (typeof apiKey === 'string' && apiKey.startsWith('env:')) {
    apiKey = process.env[apiKey.slice(4)] || ''
  }
  if (apiKey) {
    process.env.OPENAI_API_KEY = apiKey
  }
  process.env.OPENAI_BASE_URL = target.baseUrl
  process.env.OPENAI_MODEL = target.model

  // Persist choice — survives restart!
  config.activeProvider = target.name
  config.activeModel = target.model
  saveConfig(config)

  const url = target.baseUrl.replace(/https?:\/\//, '').replace(/\/api.*$/, '')

  return {
    type: 'text' as const,
    value: [
      `✅ Switched to: ${target.name}`,
      `   Model: ${target.model}`,
      `   Endpoint: ${url}`,
      '',
      '  💾 Saved as default. Will be used on next start.',
    ].join('\n'),
  }
}

/**
 * Switch model within an existing provider (e.g. OpenRouter has 200+ models).
 * Usage: /model openrouter/anthropic/claude-sonnet-4
 *        /model openrouter/google/gemini-2.5-flash
 */
function switchModel(config: Config, providers: Provider[], idx: number, newModel: string): { type: 'text'; value: string } {
  const target = providers[idx]!
  const oldModel = target.model
  const resolvedModel =
    resolveConfiguredProviderModel(target, newModel) ?? newModel.trim()

  // Update the model in the provider config
  target.model = resolvedModel
  config.providers = providers

  // Update env vars immediately
  let apiKey = target.apiKey
  if (typeof apiKey === 'string' && apiKey.startsWith('env:')) {
    apiKey = process.env[apiKey.slice(4)] || ''
  }
  if (apiKey) {
    process.env.OPENAI_API_KEY = apiKey
  }
  process.env.OPENAI_BASE_URL = target.baseUrl
  process.env.OPENAI_MODEL = resolvedModel

  // Persist
  config.activeProvider = target.name
  config.activeModel = resolvedModel
  saveConfig(config)

  const url = target.baseUrl.replace(/https?:\/\//, '').replace(/\/api.*$/, '')

  return {
    type: 'text' as const,
    value: [
      `✅ Switched model within: ${target.name}`,
      `   ${oldModel} → ${resolvedModel}`,
      `   Endpoint: ${url}`,
      '',
      '  💾 Saved as default. Will be used on next start.',
    ].join('\n'),
  }
}
