/**
 * FreeClaude - Fallback Chain (utils)
 *
 * Thin adapter used by freeclaudeAuth.ts for startup auth checks.
 * Delegates to freeclaudeConfig.ts so that all provider discovery
 * logic lives in one place.
 */

import {
  getActiveFreeClaudeProvider,
  hasActiveFreeClaudeProvider,
  readFreeClaudeConfig,
  type FreeClaudeProviderConfig,
} from './freeclaudeConfig.js'

export interface Provider {
  name: string
  apiKey: string | undefined
  baseUrl: string
  model: string
  priority: number
}

function toProvider(p: FreeClaudeProviderConfig, priority: number): Provider {
  return {
    name: p.name,
    apiKey: p.apiKey || undefined,
    baseUrl: p.baseUrl,
    model: p.model,
    priority,
  }
}

export function getProvidersFromEnv(): Provider[] {
  const config = readFreeClaudeConfig()
  const providers: Provider[] = []

  const active = getActiveFreeClaudeProvider(config)
  if (active) {
    providers.push(toProvider(active, 1))
  }

  return providers
}

export function hasAnyProvider(): boolean {
  return hasActiveFreeClaudeProvider(readFreeClaudeConfig())
}

export function getPrimaryProvider(): Provider | undefined {
  const config = readFreeClaudeConfig()
  const active = getActiveFreeClaudeProvider(config)
  return active ? toProvider(active, 1) : undefined
}
