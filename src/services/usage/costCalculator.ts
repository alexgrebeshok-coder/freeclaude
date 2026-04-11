/**
 * FreeClaude v3 — Cost Calculator
 *
 * Calculates cost per request based on provider pricing.
 * v3: supports real API usage parsing (when available from response headers/body).
 */

export interface ProviderPricing {
  promptPricePer1M: number   // USD per 1M prompt tokens
  completionPricePer1M: number  // USD per 1M completion tokens
}

// Provider pricing (USD per 1M tokens)
const PROVIDER_PRICING: Record<string, ProviderPricing> = {
  // Free providers ($0)
  zai:        { promptPricePer1M: 0, completionPricePer1M: 0 },
  ollama:     { promptPricePer1M: 0, completionPricePer1M: 0 },
  gemini:     { promptPricePer1M: 0, completionPricePer1M: 0 },
  deepseek:   { promptPricePer1M: 0.14, completionPricePer1M: 0.28 },

  // Paid providers
  openai:     { promptPricePer1M: 2.5, completionPricePer1M: 10 },
  anthropic:  { promptPricePer1M: 3, completionPricePer1M: 15 },
  together:   { promptPricePer1M: 0.18, completionPricePer1M: 0.18 },
  groq:       { promptPricePer1M: 0.05, completionPricePer1M: 0.08 },
}

/**
 * Get pricing for a provider. Returns $0 if unknown (free).
 */
export function getPricing(providerName: string): ProviderPricing {
  for (const [key, pricing] of Object.entries(PROVIDER_PRICING)) {
    if (providerName.includes(key)) {
      return pricing
    }
  }
  return { promptPricePer1M: 0, completionPricePer1M: 0 }
}

/**
 * Calculate cost for a request.
 */
export function calculateCost(
  providerName: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = getPricing(providerName)
  const promptCost = (promptTokens / 1_000_000) * pricing.promptPricePer1M
  const completionCost = (completionTokens / 1_000_000) * pricing.completionPricePer1M
  return promptCost + completionCost
}

/**
 * Calculate cost from API response usage object.
 * Many providers return actual token counts in the response.
 */
export function calculateCostFromUsage(
  providerName: string,
  usage: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  },
): { costUsd: number; promptTokens: number; completionTokens: number } {
  const promptTokens = usage.prompt_tokens ?? 0
  const completionTokens = usage.completion_tokens ??
    (usage.total_tokens !== undefined ? usage.total_tokens - promptTokens : 0)

  return {
    costUsd: calculateCost(providerName, promptTokens, completionTokens),
    promptTokens,
    completionTokens,
  }
}

/**
 * Format cost for display.
 */
export function formatCost(costUsd: number): string {
  if (costUsd === 0) return '$0.0000 (free)'
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`
  if (costUsd < 1) return `$${costUsd.toFixed(2)}`
  return `$${costUsd.toFixed(2)}`
}
