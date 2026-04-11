/**
 * FreeClaude v2 — Cost Calculator
 *
 * Calculates cost per request based on provider pricing.
 * All listed providers are free ($0), but structure supports paid ones.
 */

export interface ProviderPricing {
  promptPricePer1M: number  // USD per 1M prompt tokens
  completionPricePer1M: number  // USD per 1M completion tokens
}

// Provider pricing (USD per 1M tokens)
const PROVIDER_PRICING: Record<string, ProviderPricing> = {
  // Free providers
  zai: { promptPricePer1M: 0, completionPricePer1M: 0 },
  ollama: { promptPricePer1M: 0, completionPricePer1M: 0 },
  gemini: { promptPricePer1M: 0, completionPricePer1M: 0 },

  // Paid providers (for future use)
  openai: { promptPricePer1M: 2.5, completionPricePer1M: 10 },
  deepseek: { promptPricePer1M: 0.14, completionPricePer1M: 0.28 },
  claude: { promptPricePer1M: 3, completionPricePer1M: 15 },
}

/**
 * Get pricing for a provider. Returns $0 if unknown (free).
 */
export function getPricing(providerName: string): ProviderPricing {
  // Match provider name prefix (e.g., "zai" matches "zai-bad")
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
