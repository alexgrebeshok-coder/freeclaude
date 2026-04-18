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

export type RoutingGoal = 'coding' | 'chat' | 'analysis'

interface ProviderRuntime extends ProviderConfig {
  /** Runtime penalty counter — after 3 consecutive errors, deprioritized for 5 min */
  errorStreak: number
  /** Timestamp when the provider was marked down (null = healthy) */
  markedDownAt: number | null
  /** Last measured latency in ms (null = unknown) */
  latencyMs: number | null
  /** Health status */
  health: 'unknown' | 'healthy' | 'degraded' | 'down'
  /** Timestamp of last health check */
  lastHealthCheckAt: number | null
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

function isTruthyEnv(value: string | undefined): boolean {
  switch ((value || '').trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Config file path
// ---------------------------------------------------------------------------

export const CONFIG_PATH = getFreeClaudeConfigPath()

// ---------------------------------------------------------------------------
// Errors that trigger fallback
// ---------------------------------------------------------------------------

const FALLBACK_STATUS_CODES = new Set([400, 401, 403, 429, 500, 502, 503, 504])

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

const CODING_TASK_HINTS = [
  'fix',
  'bug',
  'debug',
  'refactor',
  'implement',
  'write code',
  'generate tests',
  'test',
  'function',
  'class',
  'typescript',
  'javascript',
  'python',
  'rust',
  'golang',
  'stack trace',
  'compile',
  'build',
  'file',
]

const ANALYSIS_TASK_HINTS = [
  'analyze',
  'analysis',
  'architecture',
  'compare',
  'tradeoff',
  'reason about',
  'investigate',
  'root cause',
  'explain why',
  'design',
  'deep dive',
  'think through',
]

const CHAT_TASK_HINTS = [
  'hello',
  'hi',
  'thanks',
  'thank you',
  'quick question',
  'summarize',
  'briefly',
]

const CODING_MODEL_HINTS = [
  'coder',
  'codex',
  'codestral',
  'kimi',
  'k2.5',
  'qwen3-coder',
  'qwen-coder',
]

const ANALYSIS_MODEL_HINTS = [
  'glm-5',
  'reasoner',
  'r1',
  'qwq',
  'gpt-5',
  '70b',
  'deepseek',
]

const CHAT_MODEL_HINTS = [
  'flash',
  'mini',
  'turbo',
  '3b',
  '8b',
  'llama3.2',
  'qwen2.5:3b',
  'qwen2.5:7b',
]

function includesAny(text: string, needles: string[]): boolean {
  return needles.some(needle => text.includes(needle))
}

export function classifyRoutingGoal(input: string | undefined): RoutingGoal {
  const text = (input ?? '').trim().toLowerCase()
  if (!text) {
    return 'coding'
  }

  const codingScore =
    CODING_TASK_HINTS.filter(hint => text.includes(hint)).length +
    (/[`{};]/.test(text) ? 2 : 0)
  const analysisScore =
    ANALYSIS_TASK_HINTS.filter(hint => text.includes(hint)).length +
    (text.length > 500 ? 1 : 0)
  const chatScore =
    CHAT_TASK_HINTS.filter(hint => text.includes(hint)).length +
    (text.length < 120 ? 1 : 0)

  if (analysisScore > codingScore && analysisScore >= chatScore && analysisScore > 0) {
    return 'analysis'
  }
  if (codingScore > 0) {
    return 'coding'
  }
  if (chatScore > 0) {
    return 'chat'
  }
  return 'coding'
}

function scoreProviderForGoal(
  provider: ProviderRuntime,
  goal: RoutingGoal,
): number {
  const haystack =
    `${provider.name} ${provider.model} ${provider.baseUrl}`.toLowerCase()
  let score = -provider.priority

  if (provider.health === 'healthy') score += 6
  else if (provider.health === 'degraded') score -= 2
  else if (provider.health === 'down') score -= 12

  switch (goal) {
    case 'coding':
      if (includesAny(haystack, CODING_MODEL_HINTS)) score += 24
      if (includesAny(haystack, ANALYSIS_MODEL_HINTS)) score += 4
      if (includesAny(haystack, CHAT_MODEL_HINTS)) score -= 8
      break
    case 'analysis':
      if (includesAny(haystack, ANALYSIS_MODEL_HINTS)) score += 24
      if (includesAny(haystack, CODING_MODEL_HINTS)) score += 8
      if (includesAny(haystack, CHAT_MODEL_HINTS)) score -= 10
      break
    case 'chat':
      if (includesAny(haystack, CHAT_MODEL_HINTS)) score += 24
      if (isLocalProvider(provider.baseUrl)) score += 8
      if (includesAny(haystack, ANALYSIS_MODEL_HINTS)) score -= 10
      break
  }

  if (
    goal === 'chat' &&
    typeof provider.latencyMs === 'number' &&
    provider.latencyMs > 0
  ) {
    score += Math.max(0, 5000 - provider.latencyMs) / 500
  }

  return score
}

function pickBestProvider(
  providers: ProviderRuntime[],
  goal: RoutingGoal,
): ProviderRuntime | null {
  const candidates = providers.filter(provider => provider.markedDownAt === null)
  const source = candidates.length > 0 ? candidates : providers
  if (source.length === 0) return null

  return source
    .slice()
    .sort((a, b) => {
      const scoreDiff = scoreProviderForGoal(b, goal) - scoreProviderForGoal(a, goal)
      if (scoreDiff !== 0) return scoreDiff
      return a.priority - b.priority
    })[0] ?? null
}

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

export function isProviderRestrictionError(error: Error | undefined): boolean {
  const msg = String(error?.message || '').toLowerCase()
  return (
    msg.includes('openai api error 403:') &&
    (
      msg.includes('provider terms of service') ||
      msg.includes('violation of provider terms of service') ||
      msg.includes('request is prohibited due to a violation')
    )
  )
}

export function describeProviderError(
  error: Error | undefined,
  statusCode: number,
): string {
  if (isProviderRestrictionError(error)) {
    return 'HTTP 403 provider geo/TOS restriction'
  }

  return statusCode > 0
    ? `HTTP ${statusCode}`
    : error?.message?.slice(0, 60) || 'unknown error'
}

export function normalizeProviderError(
  error: Error,
  statusCode: number,
): Error {
  if (statusCode === 403 && isProviderRestrictionError(error)) {
    return new Error(
      'OpenAI API error 403: Request blocked by provider Terms of Service or regional restrictions. FreeClaude can fall back to the next configured provider/model when available.\n' +
      `Original error: ${error.message}`,
    )
  }

  return error
}

export function shouldFallback(
  statusCode: number,
  error?: Error,
): boolean {
  void error
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
    latencyMs: null,
    health: 'unknown',
    lastHealthCheckAt: null,
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
            .filter(p => p.apiKey || isLocalProvider(p.baseUrl))

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
    const preferEnvOpenRouter =
      isTruthyEnv(process.env.FREECLAUDE_PREFER_ENV_OPENROUTER)
    const firstLocalProviderIndex = this.providers.findIndex(provider =>
      isLocalProvider(provider.baseUrl),
    )
    let insertIndex = preferEnvOpenRouter
      ? 0
      : firstLocalProviderIndex >= 0
        ? firstLocalProviderIndex
        : this.providers.length

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
      this.log(
        'info',
        `${preferEnvOpenRouter ? 'Prepended' : 'Appended'} ${spec.name} provider from ${spec.envKey}`,
      )
    }
  }

  // ---- Provider selection ----

  /**
   * Get the current (best) provider for a request.
   * Skips providers that are marked down (unless cooldown expired).
   */
  getCurrent(goal?: RoutingGoal): ProviderRuntime | null {
    this.recoverMarkedDown()

    if (goal) {
      return pickBestProvider(this.providers, goal)
    }

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
  getNext(failedProvider?: string, goal?: RoutingGoal): ProviderRuntime | null {
    this.recoverMarkedDown()
    this.stats.totalRequests++

    const current = this.getCurrent()
    if (!current) return null

    // If we have only one provider, just return it (no fallback possible)
    if (this.providers.length <= 1) return current

    // Find current index
    const currentIdx = this.providers.findIndex(p => p.name === (failedProvider || current.name))

    if (goal) {
      const next = pickBestProvider(
        this.providers.filter(p => p.name !== (failedProvider || current.name)),
        goal,
      )
      if (next) {
        this.stats.fallbacks[next.name] = (this.stats.fallbacks[next.name] || 0) + 1
        this.stats.lastSwitch = {
          from: failedProvider || current.name,
          to: next.name,
          reason: `error-${goal}`,
          at: new Date().toISOString(),
        }
        this.log(
          'info',
          `Switched to ${next.name} (from ${failedProvider || current.name}, routed for ${goal})`,
        )
      }
      return next
    }

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
  markSuccess(providerName: string, latencyMs?: number): void {
    const p = this.providers.find(pr => pr.name === providerName)
    if (p) {
      p.errorStreak = 0
      p.markedDownAt = null
      p.health = 'healthy'
      if (typeof latencyMs === 'number') {
        p.latencyMs = latencyMs
      }
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

  // ---- Health checks ----

  /**
   * Ping a single provider by hitting its /models endpoint.
   * Returns latency in ms, or -1 on failure.
   */
  async pingProvider(providerName: string): Promise<number> {
    const p = this.providers.find(pr => pr.name === providerName)
    if (!p) return -1

    const url = `${p.baseUrl.replace(/\/+$/, '')}/models`
    const start = Date.now()
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10000)
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${p.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      })
      clearTimeout(timer)
      const latency = Date.now() - start

      p.lastHealthCheckAt = Date.now()
      p.latencyMs = latency

      if (resp.ok) {
        p.health = latency > 5000 ? 'degraded' : 'healthy'
        this.log('debug', `Health: ${p.name} → ${p.health} (${latency}ms)`)
      } else if (resp.status === 401 || resp.status === 403) {
        p.health = 'down'
        this.log('warn', `Health: ${p.name} → down (auth error ${resp.status})`)
      } else {
        p.health = 'degraded'
        this.log('warn', `Health: ${p.name} → degraded (HTTP ${resp.status}, ${latency}ms)`)
      }
      return latency
    } catch {
      p.health = 'down'
      p.latencyMs = -1
      p.lastHealthCheckAt = Date.now()
      this.log('warn', `Health: ${p.name} → down (unreachable)`)
      return -1
    }
  }

  /**
   * Health-check all providers concurrently.
   * Returns a map of provider name → { health, latencyMs }.
   */
  async healthCheckAll(): Promise<Record<string, { health: string; latencyMs: number }>> {
    const results: Record<string, { health: string; latencyMs: number }> = {}
    await Promise.all(
      this.providers.map(async (p) => {
        const latency = await this.pingProvider(p.name)
        results[p.name] = { health: p.health, latencyMs: latency }
      }),
    )
    return results
  }

  /**
   * Get provider health info without performing a check.
   */
  getProviderHealth(): Array<{ name: string; health: string; latencyMs: number | null; lastCheck: number | null }> {
    return this.providers.map(p => ({
      name: p.name,
      health: p.health,
      latencyMs: p.latencyMs,
      lastCheck: p.lastHealthCheckAt,
    }))
  }
}
