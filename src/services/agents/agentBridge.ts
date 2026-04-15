/**
 * FreeClaude v3 — Agent Bridge
 *
 * Thin adapter that connects inherited Claude Code agent infrastructure
 * to FreeClaude's multi-provider backend.
 *
 * Key responsibilities:
 * 1. Select provider for agent (can differ from main session)
 * 2. Pass FreeClaude config to spawned agents via env vars
 * 3. Ensure OPENAI_BASE_URL and OPENAI_API_KEY are set for agents
 * 4. Collect results and translate back to FreeClaude format
 *
 * The inherited agent system (AgentTool → runAgent → inProcessRunner)
 * calls through mainLoopModel which uses the OpenAI-compatible API.
 * FreeClaude's openaiShim intercepts at HTTP level, so agents
 * SHOULD work if the env vars are set correctly.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface AgentConfig {
  provider: string
  model: string
  baseUrl: string
  apiKey: string
}

/**
 * Get the active provider config for agent spawning.
 * Reads from ~/.freeclaude.json or environment.
 */
export function getAgentProviderConfig(): AgentConfig | null {
  // Check env override first
  if (process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY) {
    return {
      provider: process.env.FREECLAUDE_PROVIDER || 'env',
      model: process.env.FREECLAUDE_MODEL || process.env.OPENAI_MODEL || 'default',
      baseUrl: process.env.OPENAI_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    }
  }

  // Read from config
  try {
    const configPath = process.env.FREECLAUDE_CONFIG_PATH || join(homedir(), '.freeclaude.json')
    if (!existsSync(configPath)) return null

    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    const activeIdx = config.activeProvider ?? 0
    const provider = config.providers?.[activeIdx]

    if (!provider) return null

    return {
      provider: provider.name || `provider-${activeIdx}`,
      model: provider.model || 'default',
      baseUrl: provider.baseUrl || provider.endpoint || '',
      apiKey: provider.apiKey || '',
    }
  } catch {
    return null
  }
}

/**
 * Build environment variables for a spawned agent.
 * These ensure the agent uses FreeClaude's provider.
 */
export function buildAgentEnv(overrides?: Partial<AgentConfig>): Record<string, string> {
  const config = overrides ? { ...getAgentProviderConfig(), ...overrides } : getAgentProviderConfig()
  if (!config) return {}

  const env: Record<string, string> = {}

  if (config.baseUrl) {
    env.OPENAI_BASE_URL = config.baseUrl
  }
  if (config.apiKey) {
    env.OPENAI_API_KEY = config.apiKey
  }
  if (config.model) {
    env.OPENAI_MODEL = config.model
    env.FREECLAUDE_MODEL = config.model
  }
  if (config.provider) {
    env.FREECLAUDE_PROVIDER = config.provider
  }

  // Pass config path for consistency
  const configPath = process.env.FREECLAUDE_CONFIG_PATH || join(homedir(), '.freeclaude.json')
  env.FREECLAUDE_CONFIG_PATH = configPath

  // Ensure the agent knows it's in agent mode
  env.CLAUDE_CODE_AGENT_MODE = '1'

  return env
}

/**
 * Verify that the current environment can support agent spawning.
 * Returns diagnostics.
 */
export function verifyAgentReadiness(): {
  ready: boolean
  issues: string[]
  config: AgentConfig | null
} {
  const issues: string[] = []
  const config = getAgentProviderConfig()

  if (!config) {
    issues.push('No provider configured (need ~/.freeclaude.json or OPENAI_BASE_URL)')
  } else {
    if (!config.baseUrl) issues.push('No base URL configured for provider')
    if (!config.apiKey) issues.push('No API key configured for provider')
    if (!config.model || config.model === 'default') issues.push('No specific model configured')
  }

  // Check if inherited agent infrastructure is available
  try {
    // The AgentTool should be in the bundle
    const bundlePath = join(__dirname, '../../dist/cli.bundle.mjs')
    if (!existsSync(bundlePath)) {
      issues.push('cli.bundle.mjs not found')
    }
  } catch {
    // Not critical — bundle check is best-effort
  }

  return {
    ready: issues.length === 0,
    issues,
    config,
  }
}

/**
 * Format agent readiness for CLI display.
 */
export function formatAgentReadiness(): string {
  const { ready, issues, config } = verifyAgentReadiness()

  const lines: string[] = [
    `🤖 Agent Readiness: ${ready ? '✅ READY' : '⚠️ NOT READY'}`,
    '',
  ]

  if (config) {
    lines.push(`   Provider: ${config.provider}`)
    lines.push(`   Model:    ${config.model}`)
    lines.push(`   Endpoint: ${config.baseUrl}`)
    lines.push('')
  }

  if (issues.length > 0) {
    lines.push('   Issues:')
    for (const issue of issues) {
      lines.push(`     ❌ ${issue}`)
    }
  }

  lines.push('')
  lines.push('   Feature flags enabled:')
  lines.push('     ✅ COORDINATOR_MODE')
  lines.push('     ✅ BUILTIN_EXPLORE_PLAN_AGENTS')
  lines.push('     ✅ FORK_SUBAGENT')
  lines.push('     ✅ AGENT_MEMORY_SNAPSHOT')

  return lines.join('\n')
}
