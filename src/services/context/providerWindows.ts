/**
 * FreeClaude v3 — Multi-Provider Context Windows
 *
 * Maps FreeClaude providers and models to their correct context
 * window sizes and pricing info. Extends inherited context.ts
 * with FreeClaude-specific provider knowledge.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelWindow {
  contextWindow: number
  maxOutput: number
  pricing?: { inputPer1M: number; outputPer1M: number }
}

// ---------------------------------------------------------------------------
// Known model context windows
// ---------------------------------------------------------------------------

const KNOWN_WINDOWS: Record<string, ModelWindow> = {
  // Anthropic
  'claude-sonnet-4': { contextWindow: 200_000, maxOutput: 64_000, pricing: { inputPer1M: 3, outputPer1M: 15 } },
  'claude-opus-4': { contextWindow: 200_000, maxOutput: 32_000, pricing: { inputPer1M: 15, outputPer1M: 75 } },
  'claude-haiku-3.5': { contextWindow: 200_000, maxOutput: 8_192, pricing: { inputPer1M: 0.8, outputPer1M: 4 } },

  // OpenAI
  'gpt-4o': { contextWindow: 128_000, maxOutput: 16_384, pricing: { inputPer1M: 2.5, outputPer1M: 10 } },
  'gpt-4o-mini': { contextWindow: 128_000, maxOutput: 16_384, pricing: { inputPer1M: 0.15, outputPer1M: 0.6 } },
  'gpt-4.1': { contextWindow: 1_000_000, maxOutput: 32_768, pricing: { inputPer1M: 2, outputPer1M: 8 } },
  'gpt-4.1-mini': { contextWindow: 1_000_000, maxOutput: 32_768, pricing: { inputPer1M: 0.4, outputPer1M: 1.6 } },
  'gpt-4.1-nano': { contextWindow: 1_000_000, maxOutput: 32_768, pricing: { inputPer1M: 0.1, outputPer1M: 0.4 } },
  'o3': { contextWindow: 200_000, maxOutput: 100_000, pricing: { inputPer1M: 10, outputPer1M: 40 } },
  'o3-mini': { contextWindow: 200_000, maxOutput: 100_000, pricing: { inputPer1M: 1.1, outputPer1M: 4.4 } },
  'o4-mini': { contextWindow: 200_000, maxOutput: 100_000, pricing: { inputPer1M: 1.1, outputPer1M: 4.4 } },

  // Google
  'gemini-2.5-pro': { contextWindow: 1_000_000, maxOutput: 65_536, pricing: { inputPer1M: 1.25, outputPer1M: 10 } },
  'gemini-2.5-flash': { contextWindow: 1_000_000, maxOutput: 65_536, pricing: { inputPer1M: 0.15, outputPer1M: 0.6 } },
  'gemini-2.0-flash': { contextWindow: 1_000_000, maxOutput: 8_192, pricing: { inputPer1M: 0.1, outputPer1M: 0.4 } },

  // GigaChat
  'gigachat-pro': { contextWindow: 32_768, maxOutput: 4_096, pricing: { inputPer1M: 0, outputPer1M: 0 } },
  'gigachat-max': { contextWindow: 32_768, maxOutput: 4_096, pricing: { inputPer1M: 0, outputPer1M: 0 } },

  // Ollama / local (context depends on quantization and RAM, use conservative defaults)
  'qwen3': { contextWindow: 32_768, maxOutput: 8_192 },
  'qwen2.5': { contextWindow: 32_768, maxOutput: 8_192 },
  'deepseek-coder-v2': { contextWindow: 128_000, maxOutput: 8_192 },
  'llama3.3': { contextWindow: 128_000, maxOutput: 8_192 },
  'codestral': { contextWindow: 32_768, maxOutput: 8_192 },
  'mistral': { contextWindow: 32_768, maxOutput: 8_192 },
}

// Default for unknown models
const DEFAULT_WINDOW: ModelWindow = {
  contextWindow: 128_000,
  maxOutput: 8_192,
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Get context window info for a model.
 * Tries fuzzy matching on model name.
 */
export function getModelWindow(model: string): ModelWindow {
  const lower = model.toLowerCase()

  // Exact match
  if (KNOWN_WINDOWS[lower]) return KNOWN_WINDOWS[lower]!

  // Fuzzy match: find longest matching key
  let bestMatch: string | null = null
  let bestLength = 0

  for (const key of Object.keys(KNOWN_WINDOWS)) {
    if (lower.includes(key) && key.length > bestLength) {
      bestMatch = key
      bestLength = key.length
    }
  }

  if (bestMatch) return KNOWN_WINDOWS[bestMatch]!

  return DEFAULT_WINDOW
}

/**
 * Get context window size for a model (number of tokens).
 */
export function getContextWindowForProvider(model: string): number {
  return getModelWindow(model).contextWindow
}

/**
 * Get max output tokens for a model.
 */
export function getMaxOutputForProvider(model: string): number {
  return getModelWindow(model).maxOutput
}

/**
 * Check if a model supports large context (>128K).
 */
export function isLargeContext(model: string): boolean {
  return getModelWindow(model).contextWindow > 128_000
}

/**
 * Format model window info for display.
 */
export function formatModelWindow(model: string): string {
  const w = getModelWindow(model)
  const lines = [
    `📐 Context Window: ${model}`,
    '',
    `   Context:    ${(w.contextWindow / 1000).toFixed(0)}K tokens`,
    `   Max output: ${(w.maxOutput / 1000).toFixed(0)}K tokens`,
  ]

  if (w.pricing) {
    lines.push(`   Pricing:    $${w.pricing.inputPer1M}/M input, $${w.pricing.outputPer1M}/M output`)
  }

  return lines.join('\n')
}
