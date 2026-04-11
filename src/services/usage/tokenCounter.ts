/**
 * FreeClaude v3 — Token Counter
 *
 * Counts tokens for provider responses.
 * v3: prefers actual API-reported token counts, falls back to estimation.
 */

const CHARS_PER_TOKEN_APPROX = 4 // rough estimate for most LLMs

export interface TokenCount {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/**
 * Estimate token count from text (fallback when API doesn't report usage).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN_APPROX)
}

/**
 * Get token count from API response usage if available.
 * Returns null if usage not provided (caller should estimate).
 */
export function parseApiUsage(
  usage: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  } | undefined,
): TokenCount | null {
  if (!usage) return null

  const promptTokens = usage.prompt_tokens ?? 0
  const completionTokens = usage.completion_tokens ??
    (usage.total_tokens !== undefined ? usage.total_tokens - promptTokens : 0)

  if (promptTokens === 0 && completionTokens === 0) return null

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  }
}

/**
 * Count tokens for a complete request/response pair (estimate).
 */
export function countTokens(prompt: string, completion: string): TokenCount {
  const promptTokens = estimateTokens(prompt)
  const completionTokens = estimateTokens(completion)
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  }
}

/**
 * Format token count for display.
 */
export function formatTokenCount(
  count: TokenCount,
  provider: string,
  costUsd: number,
): string {
  return `[FreeClaude] ${count.totalTokens} tokens (prompt: ${count.promptTokens}, completion: ${count.completionTokens}) | ${provider} | $${costUsd.toFixed(4)}`
}
