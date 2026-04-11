/**
 * FreeClaude v2 — Fallback Chain
 *
 * Automatic provider switching on 401/429/5xx errors.
 * Config: ~/.freeclaude.json (optional — falls back to env vars)
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

// ---------------------------------------------------------------------------
// Config file path
// ---------------------------------------------------------------------------

const CONFIG_PATH = join(homedir(), '.freeclaude.json')

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

  // ---- Loading ----

  private loadProviders(): void {
    if (existsSync(CONFIG_PATH)) {
      try {
        const raw = readFileSync(CONFIG_PATH, 'utf-8')
        const config = JSON.parse(raw)

        if (Array.isArray(config.providers)) {
          this.providers = config.providers
            .map((p: ProviderConfig) => ({
              ...p,
              apiKey: resolveApiKey(p.apiKey),
              errorStreak: 0,
              markedDownAt: null,
            }))
            .sort((a: ProviderRuntime, b: ProviderRuntime) => a.priority - b.priority)

          this.enabled = true
          this.log('info', `Loaded ${this.providers.length} providers from ${CONFIG_PATH}`)
        }

        if (config.defaults) {
          this.defaults = { ...this.defaults, ...config.defaults }
        }
      } catch (e) {
        console.error(`[FreeClaude] ERROR: Failed to parse ${CONFIG_PATH}:`, e)
      }
    }

    // Fallback to env vars if no config or no providers resolved
    if (this.providers.length === 0) {
      this.loadFromEnv()
    }
  }

  private loadFromEnv(): void {
    const apiKey = process.env.OPENAI_API_KEY
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    const model = process.env.OPENAI_MODEL || 'gpt-4o'

    if (apiKey) {
      this.providers = [
        {
          name: 'env-default',
          baseUrl,
          apiKey,
          model,
          priority: 1,
          timeout: 30000,
          errorStreak: 0,
          markedDownAt: null,
        },
      ]
      this.log('info', 'No config file, using env vars as single provider')
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
