/**
 * FreeClaude - упрощённая обработка ошибок
 * Без авторизации, только API key
 */

// Основные сообщения об ошибках
export const INVALID_API_KEY_ERROR_MESSAGE = 'API key not configured · Set OPENAI_API_KEY environment variable'
export const INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL = 'API key invalid · Check your OPENAI_API_KEY'
export const API_ERROR_MESSAGE_PREFIX = 'API Error: '
export const API_TIMEOUT_ERROR_MESSAGE = 'API request timed out'
export const CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE = 'Insufficient credits'
export const CUSTOM_OFF_SWITCH_MESSAGE = 'Model disabled'
export const TOKEN_REVOKED_ERROR_MESSAGE = 'API key revoked'
export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt too long'
export const ORG_DISABLED_ERROR_MESSAGE_ENV_KEY = 'Organization disabled'

// Fallback error
export const FALLBACK_EXHAUSTED_ERROR = 'All providers failed · Check your API keys'

export function startsWithApiErrorPrefix(message: string): boolean {
  return message.startsWith(API_ERROR_MESSAGE_PREFIX)
}
