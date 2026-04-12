/**
 * FreeClaude v3 — Cost Tracker
 *
 * Lightweight cost tracking persisted to ~/.freeclaude/costs.jsonl.
 * Tracks per-request token usage and estimated cost.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const ENV_DIR = 'FREECLAUDE_COST_DIR'

function getCostDir(): string {
  if (process.env[ENV_DIR]) return process.env[ENV_DIR]!
  return join(homedir(), '.freeclaude')
}

function getCostFile(): string {
  return join(getCostDir(), 'costs.jsonl')
}

export type CostEntry = {
  timestamp: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  estimatedCost: number
  prompt?: string
}

// Approximate cost per 1M tokens (USD)
const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  'glm-4.7-flash':    { input: 0.1,  output: 0.1 },
  'glm-4.7':          { input: 0.5,  output: 0.5 },
  'glm-5':            { input: 1.0,  output: 1.0 },
  'glm-5-turbo':      { input: 0.5,  output: 0.5 },
  'gpt-4o':           { input: 2.5,  output: 10.0 },
  'gpt-4o-mini':      { input: 0.15, output: 0.6 },
  'gpt-5':            { input: 5.0,  output: 15.0 },
  'claude-3.5-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-haiku':   { input: 0.25, output: 1.25 },
  'deepseek-chat':    { input: 0.14, output: 0.28 },
  'deepseek-r1':      { input: 0.55, output: 2.19 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'qwen-max':         { input: 2.0,  output: 6.0 },
  'ollama':           { input: 0.0,  output: 0.0 },
}

function getCostRates(model: string): { input: number; output: number } {
  // Check exact match first
  if (COST_PER_MILLION[model]) return COST_PER_MILLION[model]!
  // Check if starts with any known key (prefix match)
  for (const [key, rates] of Object.entries(COST_PER_MILLION)) {
    if (model.toLowerCase().startsWith(key.toLowerCase())) return rates
  }
  // Default: assume local/free model
  return { input: 0.0, output: 0.0 }
}

export function trackCost(entry: Omit<CostEntry, 'timestamp' | 'estimatedCost'>): CostEntry {
  const dir = getCostDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const rates = getCostRates(entry.model)
  const estimatedCost =
    (entry.inputTokens / 1_000_000) * rates.input +
    (entry.outputTokens / 1_000_000) * rates.output

  const full: CostEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
    estimatedCost,
  }

  appendFileSync(getCostFile(), JSON.stringify(full) + '\n')
  return full
}

export function getCostSummary(since?: string): {
  totalCost: number
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  avgLatency: number
  byProvider: Record<string, { cost: number; requests: number; tokens: number }>
  byModel: Record<string, { cost: number; requests: number; tokens: number }>
} {
  const file = getCostFile()
  if (!existsSync(file)) {
    return {
      totalCost: 0, totalRequests: 0,
      totalInputTokens: 0, totalOutputTokens: 0,
      avgLatency: 0, byProvider: {}, byModel: {},
    }
  }

  const sinceDate = since ? new Date(since) : new Date(0)
  const lines = readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean)

  let totalCost = 0
  let totalRequests = 0
  let totalInput = 0
  let totalOutput = 0
  let totalLatency = 0
  const byProvider: Record<string, { cost: number; requests: number; tokens: number }> = {}
  const byModel: Record<string, { cost: number; requests: number; tokens: number }> = {}

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as CostEntry
      if (new Date(entry.timestamp) < sinceDate) continue

      totalCost += entry.estimatedCost
      totalRequests++
      totalInput += entry.inputTokens
      totalOutput += entry.outputTokens
      totalLatency += entry.latencyMs

      byProvider[entry.provider] = byProvider[entry.provider] ?? { cost: 0, requests: 0, tokens: 0 }
      byProvider[entry.provider]!.cost += entry.estimatedCost
      byProvider[entry.provider]!.requests++
      byProvider[entry.provider]!.tokens += entry.inputTokens + entry.outputTokens

      byModel[entry.model] = byModel[entry.model] ?? { cost: 0, requests: 0, tokens: 0 }
      byModel[entry.model]!.cost += entry.estimatedCost
      byModel[entry.model]!.requests++
      byModel[entry.model]!.tokens += entry.inputTokens + entry.outputTokens
    } catch { /* skip bad lines */ }
  }

  return {
    totalCost,
    totalRequests,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    avgLatency: totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
    byProvider,
    byModel,
  }
}

export function clearCosts(): number {
  const file = getCostFile()
  if (!existsSync(file)) return 0
  const lines = readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).length
  writeFileSync(file, '')
  return lines
}
