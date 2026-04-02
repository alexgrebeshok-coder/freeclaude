/**
 * FreeClaude - Fallback Chain
 * Автоматическое переключение между провайдерами
 */

export interface Provider {
  name: string
  apiKey: string | undefined
  baseUrl: string
  model: string
  priority: number
}

export function getProvidersFromEnv(): Provider[] {
  const providers: Provider[] = []

  // Primary provider
  const primaryKey = process.env.OPENAI_API_KEY
  if (primaryKey) {
    providers.push({
      name: 'primary',
      apiKey: primaryKey,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      priority: 1
    })
  }

  // Fallback 1
  const fallback1Key = process.env.FALLBACK1_API_KEY || process.env.FALLBACK_API_KEY
  if (fallback1Key) {
    providers.push({
      name: 'fallback1',
      apiKey: fallback1Key,
      baseUrl: process.env.FALLBACK1_BASE_URL || process.env.FALLBACK_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.FALLBACK1_MODEL || process.env.FALLBACK_MODEL || 'gpt-4o-mini',
      priority: 2
    })
  }

  // Fallback 2
  const fallback2Key = process.env.FALLBACK2_API_KEY
  if (fallback2Key) {
    providers.push({
      name: 'fallback2',
      apiKey: fallback2Key,
      baseUrl: process.env.FALLBACK2_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.FALLBACK2_MODEL || 'gpt-4o-mini',
      priority: 3
    })
  }

  // Ollama local (всегда последний)
  if (process.env.OLLAMA_BASE_URL) {
    providers.push({
      name: 'ollama',
      apiKey: 'ollama', // Ollama не требует ключ
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL || 'llama3.2',
      priority: 99
    })
  }

  return providers.sort((a, b) => a.priority - b.priority)
}

export function hasAnyProvider(): boolean {
  return getProvidersFromEnv().length > 0
}

export function getPrimaryProvider(): Provider | undefined {
  return getProvidersFromEnv()[0]
}
