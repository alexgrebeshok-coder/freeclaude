/**
 * FreeClaude v2 — Token Counter
 *
 * Counts tokens for provider responses. Uses tiktoken for OpenAI/Gemini,
 * estimates ~4 chars/token for Ollama models.
 */

// Simple token estimation (no external deps needed)
// For accurate counting, tiktoken would be ideal but adds complexity

const CHARS_PER_TOKEN_APPROX = 4 // rough estimate for most LLMs

export interface TokenCount {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/**
 * Estimate token count from text.
 * For local models (Ollama), uses character ratio.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN_APPROX)
}

/**
 * Count tokens for a complete request/response pair.
 */
export function countTokens(
  prompt: string,
  completion: string,
): TokenCount {
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
export function formatTokenCount(count: TokenCount, provider: string, costUsd: number): string {
  return `[FreeClaude] ${count.totalTokens} tokens (prompt: ${count.promptTokens}, completion: ${count.completionTokens}) | ${provider} | $${costUsd.toFixed(4)}`
}
