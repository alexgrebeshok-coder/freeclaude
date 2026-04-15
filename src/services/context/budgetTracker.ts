/**
 * FreeClaude v3 — Token Budget Tracker
 *
 * Tracks token usage per session and per agent.
 * Integrates with FreeClaude's multi-provider system to provide
 * cost estimates based on provider-specific pricing.
 *
 * Storage: ~/.freeclaude/usage/
 *   session-{id}.json — per-session usage
 *   totals.json       — lifetime totals
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenUsageEntry {
  timestamp: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  /** Estimated cost in USD (0 if pricing unknown) */
  costUsd: number
  /** Context: agent ID, command, or 'main' */
  context: string
}

export interface SessionUsage {
  sessionId: string
  startedAt: string
  entries: TokenUsageEntry[]
  totals: {
    inputTokens: number
    outputTokens: number
    costUsd: number
    requests: number
  }
}

export interface LifetimeUsage {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  totalRequests: number
  totalSessions: number
  byProvider: Record<string, {
    inputTokens: number
    outputTokens: number
    costUsd: number
    requests: number
  }>
  lastUpdated: string
}

// ---------------------------------------------------------------------------
// Pricing (USD per 1M tokens)
// ---------------------------------------------------------------------------

const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-sonnet-4': { input: 3.0, output: 15.0 },
  'claude-opus-4': { input: 15.0, output: 75.0 },
  'claude-haiku-3.5': { input: 0.8, output: 4.0 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2.0, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  // Local (free)
  'ollama': { input: 0, output: 0 },
  'local': { input: 0, output: 0 },
}

function estimateCost(model: string, provider: string, inputTokens: number, outputTokens: number): number {
  // Try model name first
  const modelKey = Object.keys(PRICING).find(k => model.toLowerCase().includes(k))
  if (modelKey) {
    const p = PRICING[modelKey]!
    return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
  }

  // Try provider name
  const providerKey = Object.keys(PRICING).find(k => provider.toLowerCase().includes(k))
  if (providerKey) {
    const p = PRICING[providerKey]!
    return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
  }

  return 0 // Unknown pricing
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function usageDir(): string {
  const dir = join(homedir(), '.freeclaude', 'usage')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function sessionPath(sessionId: string): string {
  return join(usageDir(), `session-${sessionId}.json`)
}

function totalsPath(): string {
  return join(usageDir(), 'totals.json')
}

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

let _currentSession: SessionUsage | null = null

/**
 * Start tracking a new session.
 */
export function startSession(sessionId?: string): string {
  const id = sessionId || `s-${Date.now()}`
  _currentSession = {
    sessionId: id,
    startedAt: new Date().toISOString(),
    entries: [],
    totals: { inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 },
  }
  return id
}

/**
 * Record a token usage event.
 */
export function recordUsage(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  context: string = 'main',
): TokenUsageEntry {
  const cost = estimateCost(model, provider, inputTokens, outputTokens)

  const entry: TokenUsageEntry = {
    timestamp: new Date().toISOString(),
    provider,
    model,
    inputTokens,
    outputTokens,
    costUsd: cost,
    context,
  }

  if (!_currentSession) {
    startSession()
  }

  _currentSession!.entries.push(entry)
  _currentSession!.totals.inputTokens += inputTokens
  _currentSession!.totals.outputTokens += outputTokens
  _currentSession!.totals.costUsd += cost
  _currentSession!.totals.requests++

  // Update lifetime totals
  updateLifetimeTotals(entry)

  return entry
}

/**
 * Get current session usage.
 */
export function getSessionUsage(): SessionUsage | null {
  return _currentSession
}

/**
 * Save current session to disk.
 */
export function saveSession(): void {
  if (!_currentSession) return
  writeFileSync(sessionPath(_currentSession.sessionId), JSON.stringify(_currentSession, null, 2), 'utf-8')
}

/**
 * End and save current session.
 */
export function endSession(): SessionUsage | null {
  if (!_currentSession) return null
  saveSession()
  const session = _currentSession
  _currentSession = null
  return session
}

// ---------------------------------------------------------------------------
// Lifetime totals
// ---------------------------------------------------------------------------

function loadLifetimeTotals(): LifetimeUsage {
  try {
    if (!existsSync(totalsPath())) {
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        totalRequests: 0,
        totalSessions: 0,
        byProvider: {},
        lastUpdated: new Date().toISOString(),
      }
    }
    return JSON.parse(readFileSync(totalsPath(), 'utf-8'))
  } catch {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      totalRequests: 0,
      totalSessions: 0,
      byProvider: {},
      lastUpdated: new Date().toISOString(),
    }
  }
}

function updateLifetimeTotals(entry: TokenUsageEntry): void {
  const totals = loadLifetimeTotals()
  totals.totalInputTokens += entry.inputTokens
  totals.totalOutputTokens += entry.outputTokens
  totals.totalCostUsd += entry.costUsd
  totals.totalRequests++
  totals.lastUpdated = entry.timestamp

  // Per-provider breakdown
  if (!totals.byProvider[entry.provider]) {
    totals.byProvider[entry.provider] = { inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 }
  }
  const prov = totals.byProvider[entry.provider]!
  prov.inputTokens += entry.inputTokens
  prov.outputTokens += entry.outputTokens
  prov.costUsd += entry.costUsd
  prov.requests++

  writeFileSync(totalsPath(), JSON.stringify(totals, null, 2), 'utf-8')
}

/**
 * Get lifetime usage totals.
 */
export function getLifetimeUsage(): LifetimeUsage {
  return loadLifetimeTotals()
}

/**
 * Count saved session files.
 */
export function getSessionCount(): number {
  try {
    return readdirSync(usageDir()).filter(f => f.startsWith('session-')).length
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

function fmtCost(usd: number): string {
  if (usd === 0) return 'free'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export function formatSessionUsage(): string {
  const session = _currentSession
  if (!session) return '📊 No active session'

  const lines = [
    '📊 Session Usage',
    '',
    `   Session:  ${session.sessionId}`,
    `   Started:  ${session.startedAt}`,
    `   Requests: ${session.totals.requests}`,
    `   Input:    ${fmtTokens(session.totals.inputTokens)} tokens`,
    `   Output:   ${fmtTokens(session.totals.outputTokens)} tokens`,
    `   Cost:     ${fmtCost(session.totals.costUsd)}`,
  ]

  return lines.join('\n')
}

export function formatLifetimeUsage(): string {
  const totals = loadLifetimeTotals()

  const lines = [
    '📊 Lifetime Usage',
    '',
    `   Requests: ${totals.totalRequests.toLocaleString()}`,
    `   Sessions: ${getSessionCount()}`,
    `   Input:    ${fmtTokens(totals.totalInputTokens)} tokens`,
    `   Output:   ${fmtTokens(totals.totalOutputTokens)} tokens`,
    `   Cost:     ${fmtCost(totals.totalCostUsd)}`,
    '',
  ]

  if (Object.keys(totals.byProvider).length > 0) {
    lines.push('   By provider:')
    for (const [name, stats] of Object.entries(totals.byProvider)) {
      lines.push(`     ${name}: ${fmtTokens(stats.inputTokens + stats.outputTokens)} tokens, ${fmtCost(stats.costUsd)}`)
    }
  }

  return lines.join('\n')
}
