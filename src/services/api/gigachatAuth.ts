/**
 * GigaChat OAuth2 authentication adapter.
 *
 * GigaChat uses client_credentials OAuth2 flow:
 *   POST https://ngw.devices.sberbank.ru/api/v2/oauth
 *   Body: scope=GIGACHAT_API_PERS
 *   Header: Authorization: Basic <base64(client_id:client_secret)>
 *   Response: { access_token: "...", expires_at: 1700000000 }
 *
 * The access_token is then used as a Bearer token for chat completions:
 *   POST https://gigachat.devices.sberbank.ru/api/v1/chat/completions
 *   Header: Authorization: Bearer <access_token>
 */

const GIGACHAT_AUTH_URL = 'https://ngw.devices.sberbank.ru/api/v2/oauth'
const GIGACHAT_API_URL = 'https://gigachat.devices.sberbank.ru/api/v1'

interface TokenResponse {
  access_token: string
  expires_at: number // Unix timestamp in seconds
}

let cachedToken: string | null = null
let tokenExpiresAt = 0
// Promise shared across concurrent callers during an in-flight token refresh.
let refreshPromise: Promise<string> | null = null

/**
 * Get a valid GigaChat access token, using cache if available.
 */
export async function getGigaChatToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && tokenExpiresAt > now + 60) {
    return cachedToken
  }

  // Deduplicate concurrent token refreshes — all callers share one pending request
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

    const response = await fetch(GIGACHAT_AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
        'RqUID': crypto.randomUUID(),
      },
      body: 'scope=GIGACHAT_API_PERS',
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error')
      throw new Error(`GigaChat OAuth error ${response.status}: ${errorBody}`)
    }

    const data = (await response.json()) as TokenResponse

    cachedToken = data.access_token
    tokenExpiresAt = data.expires_at

    return cachedToken
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

/** Reset token cache (for testing or forced refresh). */
export function resetGigaChatTokenCache(): void {
  cachedToken = null
  tokenExpiresAt = 0
  refreshPromise = null
}

/** Check if a base URL belongs to GigaChat. */
export function isGigaChatUrl(baseUrl: string): boolean {
  return /gigachat\.devices\.sberbank\.ru/i.test(baseUrl)
}

/** Get the GigaChat API base URL (without trailing slash). */
export function getGigaChatApiUrl(): string {
  return GIGACHAT_API_URL
}

/**
 * Extract client_id and client_secret from a GigaChat API key.
 *
 * Convention: the apiKey field in provider config stores
 * "client_id:client_secret" (colon-separated).
 */
export function parseGigaChatCredentials(apiKey: string): {
  clientId: string
  clientSecret: string
} {
  const colonIndex = apiKey.indexOf(':')
  if (colonIndex === -1) {
    throw new Error(
      'GigaChat apiKey must be in format "client_id:client_secret"',
    )
  }
  return {
    clientId: apiKey.slice(0, colonIndex),
    clientSecret: apiKey.slice(colonIndex + 1),
  }
}
