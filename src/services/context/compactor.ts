/**
 * FreeClaude v3 — Context Compactor
 *
 * When conversation context approaches the model's token limit,
 * this module summarizes older messages to free space while
 * preserving critical information.
 *
 * Strategy:
 * 1. Keep the last N turns verbatim (configurable, default 10)
 * 2. Summarize older turns into a compact system message
 * 3. Preserve: tool results with errors, user corrections, key decisions
 * 4. Trigger: when context reaches threshold% of model's window (default 80%)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompactionConfig {
  /** Percentage of context window that triggers compaction (0-100) */
  thresholdPercent: number
  /** Number of recent turns to keep verbatim */
  keepRecentTurns: number
  /** Maximum summary length in characters */
  maxSummaryChars: number
  /** Whether auto-compaction is enabled */
  autoEnabled: boolean
}

export interface CompactionResult {
  /** Whether compaction was performed */
  compacted: boolean
  /** Number of messages before compaction */
  messagesBefore: number
  /** Number of messages after compaction */
  messagesAfter: number
  /** Estimated tokens saved */
  tokensSaved: number
  /** Generated summary of compacted messages */
  summary: string
  /** Timestamp */
  timestamp: string
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
  metadata?: Record<string, unknown>
}

export interface CompactionHistory {
  compactions: Array<{
    timestamp: string
    messagesBefore: number
    messagesAfter: number
    tokensSaved: number
  }>
  totalCompactions: number
  totalTokensSaved: number
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CompactionConfig = {
  thresholdPercent: 80,
  keepRecentTurns: 10,
  maxSummaryChars: 2000,
  autoEnabled: true,
}

// Rough token estimation: ~4 chars per token (English), ~2 chars per token (code)
const CHARS_PER_TOKEN = 3.5

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Rough token count for a string.
 * Uses a simple heuristic — real tokenizer would be more accurate
 * but this is sufficient for compaction decisions.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Estimate total tokens for a conversation.
 */
export function estimateConversationTokens(messages: ConversationMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg.content) + 4, 0) // +4 for role/delimiter tokens
}

// ---------------------------------------------------------------------------
// Compaction logic
// ---------------------------------------------------------------------------

/**
 * Check if compaction should be triggered.
 */
export function shouldCompact(
  messages: ConversationMessage[],
  contextWindowTokens: number,
  config: Partial<CompactionConfig> = {},
): boolean {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  if (!cfg.autoEnabled) return false

  const currentTokens = estimateConversationTokens(messages)
  const threshold = contextWindowTokens * (cfg.thresholdPercent / 100)

  return currentTokens >= threshold
}

/**
 * Compact a conversation by summarizing older messages.
 *
 * Returns a CompactionResult with the new message array and stats.
 * The summary is generated locally (no API call) using extractive summarization.
 */
export function compactConversation(
  messages: ConversationMessage[],
  config: Partial<CompactionConfig> = {},
): CompactionResult {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const now = new Date().toISOString()

  if (messages.length <= cfg.keepRecentTurns * 2) {
    return {
      compacted: false,
      messagesBefore: messages.length,
      messagesAfter: messages.length,
      tokensSaved: 0,
      summary: '',
      timestamp: now,
    }
  }

  // Split: older messages to summarize, recent to keep
  const keepCount = cfg.keepRecentTurns * 2 // user + assistant per turn
  const toSummarize = messages.slice(0, messages.length - keepCount)
  const toKeep = messages.slice(messages.length - keepCount)

  // Generate extractive summary from older messages
  const summary = generateSummary(toSummarize, cfg.maxSummaryChars)

  const tokensBefore = estimateConversationTokens(messages)
  const tokensAfter = estimateTokens(summary) + estimateConversationTokens(toKeep)

  return {
    compacted: true,
    messagesBefore: messages.length,
    messagesAfter: toKeep.length + 1, // +1 for summary message
    tokensSaved: Math.max(0, tokensBefore - tokensAfter),
    summary,
    timestamp: now,
  }
}

/**
 * Generate an extractive summary from messages.
 * Extracts key information: decisions, errors, corrections, code references.
 */
function generateSummary(messages: ConversationMessage[], maxChars: number): string {
  const keyPoints: string[] = []

  for (const msg of messages) {
    const content = msg.content.trim()
    if (!content) continue

    // Extract key information types
    if (isDecision(content)) {
      keyPoints.push(`[Decision] ${extractFirstSentence(content)}`)
    } else if (isError(content)) {
      keyPoints.push(`[Error] ${extractFirstSentence(content)}`)
    } else if (isCorrection(content)) {
      keyPoints.push(`[Correction] ${extractFirstSentence(content)}`)
    } else if (msg.role === 'user' && content.length > 20) {
      // Keep user requests (abbreviated)
      keyPoints.push(`[User] ${extractFirstSentence(content)}`)
    }
  }

  // Truncate to fit maxChars
  let summary = keyPoints.join('\n')
  if (summary.length > maxChars) {
    summary = summary.slice(0, maxChars - 3) + '...'
  }

  if (!summary) {
    summary = `[Compacted ${messages.length} messages from earlier conversation]`
  }

  return `=== Earlier conversation summary ===\n${summary}\n=== End summary ===`
}

function extractFirstSentence(text: string): string {
  const match = text.match(/^[^.!?\n]{10,200}[.!?]/)
  if (match) return match[0]
  return text.slice(0, 150) + (text.length > 150 ? '...' : '')
}

function isDecision(text: string): boolean {
  return /(?:decided|chose|will use|going with|let's go|выбрали|решили)/i.test(text)
}

function isError(text: string): boolean {
  return /(?:error|failed|exception|bug|crash|ошибка|сбой)/i.test(text)
}

function isCorrection(text: string): boolean {
  return /(?:actually|correction|wrong|instead|no,|нет,|поправк)/i.test(text)
}

// ---------------------------------------------------------------------------
// History tracking
// ---------------------------------------------------------------------------

function historyPath(): string {
  return join(homedir(), '.freeclaude', 'compaction-history.json')
}

export function loadHistory(): CompactionHistory {
  try {
    const p = historyPath()
    if (!existsSync(p)) return { compactions: [], totalCompactions: 0, totalTokensSaved: 0 }
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return { compactions: [], totalCompactions: 0, totalTokensSaved: 0 }
  }
}

export function recordCompaction(result: CompactionResult): void {
  const history = loadHistory()
  history.compactions.push({
    timestamp: result.timestamp,
    messagesBefore: result.messagesBefore,
    messagesAfter: result.messagesAfter,
    tokensSaved: result.tokensSaved,
  })
  history.totalCompactions++
  history.totalTokensSaved += result.tokensSaved

  // Keep last 100 entries
  if (history.compactions.length > 100) {
    history.compactions = history.compactions.slice(-100)
  }

  const dir = join(homedir(), '.freeclaude')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(historyPath(), JSON.stringify(history, null, 2), 'utf-8')
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatCompactionStats(): string {
  const history = loadHistory()
  const lines = [
    '📦 Context Compaction Stats',
    '',
    `   Total compactions:  ${history.totalCompactions}`,
    `   Total tokens saved: ${history.totalTokensSaved.toLocaleString()}`,
    '',
  ]

  if (history.compactions.length > 0) {
    const last = history.compactions[history.compactions.length - 1]!
    lines.push(`   Last compaction:`)
    lines.push(`     Time:    ${last.timestamp}`)
    lines.push(`     Before:  ${last.messagesBefore} messages`)
    lines.push(`     After:   ${last.messagesAfter} messages`)
    lines.push(`     Saved:   ${last.tokensSaved.toLocaleString()} tokens`)
  }

  return lines.join('\n')
}
