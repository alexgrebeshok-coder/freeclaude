/**
 * FreeClaude - Упрощённая авторизация
 * Только env vars, без OAuth и keychain
 */

import { getProvidersFromEnv, hasAnyProvider, getPrimaryProvider } from './fallbackChain.js'

export interface AuthStatus {
  configured: boolean
  provider: string
  model: string
  hasFallbacks: boolean
}

/**
 * Проверить, настроен ли API
 */
export function isAuthConfigured(): boolean {
  return hasAnyProvider()
}

/**
 * Получить API ключ для запросов
 */
export function getApiKey(): string | undefined {
  const provider = getPrimaryProvider()
  return provider?.apiKey
}

/**
 * Получить base URL для запросов
 */
export function getBaseUrl(): string {
  const provider = getPrimaryProvider()
  return provider?.baseUrl || 'https://api.openai.com/v1'
}

/**
 * Получить модель для запросов
 */
export function getModel(): string {
  const provider = getPrimaryProvider()
  return provider?.model || 'gpt-4o-mini'
}

/**
 * Получить статус авторизации
 */
export function getAuthStatus(): AuthStatus {
  const providers = getProvidersFromEnv()
  const primary = providers[0]

  return {
    configured: providers.length > 0,
    provider: primary?.name || 'none',
    model: primary?.model || 'none',
    hasFallbacks: providers.length > 1
  }
}

/**
 * Валидация API ключа (базовая)
 */
export function validateApiKey(key: string | undefined): boolean {
  if (!key) return false
  if (key === 'SUA_CHAVE') return false // Placeholder
  if (key.length < 10) return false
  return true
}

/**
 * Логирование статуса при запуске
 */
export function logAuthStatus(): void {
  const status = getAuthStatus()

  if (!status.configured) {
    console.error('❌ No API key configured')
    console.error('Set OPENAI_API_KEY environment variable')
    console.error('')
    console.error('Example:')
    console.error('  export OPENAI_API_KEY=your-key-here')
    console.error('  export OPENAI_BASE_URL=https://api.z.ai/api/coding/paas/v4')
    console.error('  export OPENAI_MODEL=glm-4.7-flash')
    process.exit(1)
  }

  console.error(`✅ Provider: ${status.provider}`)
  console.error(`✅ Model: ${status.model}`)
  if (status.hasFallbacks) {
    console.error(`✅ Fallbacks: enabled`)
  }
}
