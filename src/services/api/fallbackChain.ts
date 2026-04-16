/**
 * FreeClaude v2 — Fallback Chain
 *
 * Automatic provider switching on 401/429/5xx errors.
 * Config: ~/.freeclaude.json (optional — falls back to env vars)
 */

import {
  getFreeClaudeConfigPath,
  getOrderedConfiguredProviders,
  normalizeFreeClaudeConfig,
  readFreeClaudeConfig,
  writeFreeClaudeConfig,
} from '../../utils/freeclaudeConfig.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  priority: number
  timeout: number
}

export interface FallbackDefaults {
  maxRetries: number
  retryDelay: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

export interface FallbackStats {
  totalRequests: number
  fallbacks: Record<string, number>   // provider -> count of switches TO it
  errors: Record<string, number>      // provider -> count of errors
  lastSwitch?: { from: string; to: string; reason: string; at: string }
}

interface ProviderRuntime extends ProviderConfig {
  /** Runtime penalty counter — after 3 consecutive errors, deprioritized for 5 min */
  errorStreak: number
  /** Timestamp when the provider was marked down (null = healthy) */
  markedDownAt: number | null
}

type EnvProviderSpec = {
  name: string
  envKey: string
  modelEnvKey?: string
  baseUrl: string
  defaultModel: string
  timeout: number
}

const ENV_PROVIDER_SPECS: EnvProviderSpec[] = [
  {
    name: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    modelEnvKey: 'OPENROUTER_MODEL',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'qwen/qwen3-coder-next',
    timeout: 120000,
  },
]

// ---------------------------------------------------------------------------
// Config file path
// ---------------------------------------------------------------------------

export const CONFIG_PATH = getFreeClaudeConfigPath()

// ---------------------------------------------------------------------------
// Errors that trigger fallback
// ---------------------------------------------------------------------------

const FALLBACK_STATUS_CODES = new Set([401, 429, 500, 502, 503, 504])

// Network error patterns that should trigger fallback
const NETWORK_ERROR_PATTERNS = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'socket hang up',
  'fetch failed',
  'network error',
  'abort error',
]

function toFallbackLogLevel(
  value: unknown,
): FallbackDefaults['logLevel'] | undefined {
  return value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error'
    ? value
    : undefined
}

export function shouldFallback(statusCode: number): boolean {
  return FALLBACK_STATUS_CODES.has(statusCode)
}

/**
 * Check if an error message indicates a network/transport failure.
 */
export function isNetworkError(error: Error): boolean {
  const msg = error.message.toLowerCase()
  return NETWORK_ERROR_PATTERNS.some(p => msg.includes(p.toLowerCase()))
}

// ---------------------------------------------------------------------------
// API key resolution
// ---------------------------------------------------------------------------

export function resolveApiKey(value: string): string {
  if (value.startsWith('env:')) {
    const envVar = value.slice(4)
    const resolved = process.env[envVar]
    if (!resolved) {
      console.error(`[FreeClaude] WARNING: env var ${envVar} not set for provider`)
      return ''
    }
    return resolved
  }
  return value
}

function isLocalProvider(baseUrl: string): boolean {
  const normalized = baseUrl.trim().toLowerCase()
  return normalized.startsWith('http://localhost') ||
    normalized.startsWith('http://127.0.0.1') ||
    normalized.startsWith('http://[::1]') ||
    normalized.startsWith('https://localhost') ||
    normalized.startsWith('https://127.0.0.1') ||
    normalized.startsWith('https://[::1]')
}

function createRuntimeProvider(
  config: ProviderConfig,
): ProviderRuntime {
  return {
    ...config,
    errorStreak: 0,
    markedDownAt: null,
  }
}

// ---------------------------------------------------------------------------
// FallbackChain
// ---------------------------------------------------------------------------

export class FallbackChain {
  private providers: ProviderRuntime[] = []
  private defaults: FallbackDefaults = {
    maxRetries: 3,
    retryDelay: 1000,
    logLevel: 'info',
  }
  private stats: FallbackStats = {
    totalRequests: 0,
    fallbacks: {},
    errors: {},
  }
  private currentIndex = 0
  private enabled = false

  constructor() {
    this.loadProviders()
  }

  /**
   * FreeClaude: switch to a specific provider by name (immediate, in-session).
   * Moves the target provider to the front of the chain.
   */
  setCurrentByName(name: string): boolean {
    const idx = this.providers.findIndex(p => p.name === name)
    if (idx < 0) return false
    const [target] = this.providers.splice(idx, 1)
    this.providers.unshift(target)
    return true
  }

  // ---- Loading ----

  loadProviders(): void {
    const configPath = getFreeClaudeConfigPath()
    const rawConfig = readFreeClaudeConfig()
    if (rawConfig) {
      try {
        const normalized = normalizeFreeClaudeConfig(rawConfig)
        const config = normalized.config

        if (normalized.changed) {
          writeFreeClaudeConfig(config)
        }

        if (Array.isArray(config.providers)) {
          this.providers = getOrderedConfiguredProviders(config)
            .map(p => createRuntimeProvider({
              name: p.name,
              baseUrl: p.baseUrl,
              apiKey: resolveApiKey(p.apiKey),
              model: p.model,
              priority: p.priority ?? 999,
              timeout: p.timeout ?? 30000,
            }))

          this.enabled = true
          this.log('info', `Loaded ${this.providers.length} providers from ${configPath}`)
        }

        if (config.defaults) {
          this.defaults = {
            ...this.defaults,
            ...(typeof config.defaults.maxRetries === 'number'
              ? { maxRetries: config.defaults.maxRetries }
              : {}),
            ...(typeof config.defaults.retryDelay === 'number'
              ? { retryDelay: config.defaults.retryDelay }
              : {}),
            ...(toFallbackLogLevel(config.defaults.logLevel)
              ? { logLevel: toFallbackLogLevel(config.defaults.logLevel) }
              : {}),
          }
        }
      } catch (e) {
        console.error(`[FreeClaude] ERROR: Failed to parse ${configPath}:`, e)
      }
    }

    // Fallback to env vars if no config or no providers resolved
    if (this.providers.length === 0) {
      this.loadFromEnv()
    }

    this.appendEnvProviders()
  }

  private loadFromEnv(): void {
    const apiKey = process.env.OPENAI_API_KEY
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    const model = process.env.OPENAI_MODEL || 'gpt-4o'

    if (apiKey) {
      this.providers = [
        createRuntimeProvider({
          name: 'env-default',
          baseUrl,
          apiKey,
          model,
          priority: 1,
          timeout: 30000,
        }),
      ]
      this.log('info', 'No config file, using env vars as single provider')
    }
  }

  private appendEnvProviders(): void {
    const existingNames = new Set(
      this.providers.map(provider => provider.name.toLowerCase()),
    )
    const firstLocalProviderIndex = this.providers.findIndex(provider =>
      isLocalProvider(provider.baseUrl),
    )
    let insertIndex =
      firstLocalProviderIndex >= 0 ? firstLocalProviderIndex : this.providers.length

    for (const spec of ENV_PROVIDER_SPECS) {
      if (existingNames.has(spec.name)) {
        continue
      }

      const apiKey = process.env[spec.envKey]?.trim()
      if (!apiKey) {
        continue
      }

      const model =
        process.env[spec.modelEnvKey ?? '']?.trim() ||
        spec.defaultModel

      const provider = createRuntimeProvider({
        name: spec.name,
        baseUrl: spec.baseUrl,
        apiKey,
        model,
        priority: insertIndex + 1,
        timeout: spec.timeout,
      })

      this.providers.splice(insertIndex, 0, provider)
      existingNames.add(spec.name)
      insertIndex += 1
      this.enabled = true
      this.log('info', `Appended ${spec.name} provider from ${spec.envKey}`)
    }
  }

  // ---- Provider selection ----

  /**
   * Get the current (best) provider for a request.
   * Skips providers that are marked down (unless cooldown expired).
   */
  getCurrent(): ProviderRuntime | null {
    this.recoverMarkedDown()

    for (const p of this.providers) {
      if (p.markedDownAt === null) {
        return p
      }
    }

    // All providers down — return the first one anyway (better than nothing)
    return this.providers[0] || null
  }

  /**
   * Get next available provider after an error.
   * Returns null if no more providers to try.
   */
  getNext(failedProvider?: string): ProviderRuntime | null {
    this.recoverMarkedDown()
    this.stats.totalRequests++

    const current = this.getCurrent()
    if (!current) return null

    // If we have only one provider, just return it (no fallback possible)
    if (this.providers.length <= 1) return current

    // Find current index
    const currentIdx = this.providers.findIndex(p => p.name === (failedProvider || current.name))

    // Try to find next healthy provider
    for (let i = currentIdx + 1; i < this.providers.length; i++) {
      const p = this.providers[i]
      if (p.markedDownAt === null) {
        this.stats.fallbacks[p.name] = (this.stats.fallbacks[p.name] || 0) + 1
        this.stats.lastSwitch = {
          from: failedProvider || current.name,
          to: p.name,
          reason: 'error',
          at: new Date().toISOString(),
        }
        this.log('info', `Switched to ${p.name} (from ${failedProvider || current.name})`)
        return p
      }
    }

    // Wrap around — try from the beginning
    for (let i = 0; i < currentIdx; i++) {
      const p = this.providers[i]
      if (p.markedDownAt === null) {
        this.stats.fallbacks[p.name] = (this.stats.fallbacks[p.name] || 0) + 1
        this.stats.lastSwitch = {
          from: failedProvider || current.name,
          to: p.name,
          reason: 'error-wrap',
          at: new Date().toISOString(),
        }
        this.log('warn', `All providers exhausted, wrapping to ${p.name}`)
        return p
      }
    }

    return null
  }

  /**
   * Report a successful request for a provider (resets error streak).
   */
  markSuccess(providerName: string): void {
    const p = this.providers.find(pr => pr.name === providerName)
    if (p) {
      p.errorStreak = 0
      p.markedDownAt = null
    }
  }

  /**
   * Report an error for a provider. After 3 consecutive errors, marks it down for 5 min.
   */
  markDown(providerName: string): void {
    const p = this.providers.find(pr => pr.name === providerName)
    if (!p) return

    p.errorStreak++
    this.stats.errors[providerName] = (this.stats.errors[providerName] || 0) + 1

    if (p.errorStreak >= 3) {
      p.markedDownAt = Date.now()
      this.log('warn', `Provider ${providerName} marked down (3 consecutive errors, cooldown 5 min)`)
    }
  }

  /**
   * Manually restore a provider.
   */
  markUp(providerName: string): void {
    const p = this.providers.find(pr => pr.name === providerName)
    if (p) {
      p.errorStreak = 0
      p.markedDownAt = null
      this.log('info', `Provider ${providerName} restored`)
    }
  }

  // ---- Stats ----

  getStats(): FallbackStats {
    return { ...this.stats }
  }

  isEnabled(): boolean {
    return this.enabled && this.providers.length > 1
  }

  getProviders(): ProviderConfig[] {
    return this.providers.map(p => ({
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      priority: p.priority,
      timeout: p.timeout,
    }))
  }

  getDefaults(): FallbackDefaults {
    return { ...this.defaults }
  }

  // ---- Internal ----

  private recoverMarkedDown(): void {
    const now = Date.now()
    const cooldownMs = 5 * 60 * 1000 // 5 minutes

    for (const p of this.providers) {
      if (p.markedDownAt !== null && now - p.markedDownAt > cooldownMs) {
        p.markedDownAt = null
        p.errorStreak = 0
        this.log('info', `Provider ${p.name} recovered from cooldown`)
      }
    }
  }

  private log(level: string, message: string): void {
    const levels = ['debug', 'info', 'warn', 'error']
    if (levels.indexOf(level) >= levels.indexOf(this.defaults.logLevel)) {
      console.error(`[FreeClaude] ${message}`)
    }
  }
}
