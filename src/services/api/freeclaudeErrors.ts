/**
 * FreeClaude typed error hierarchy.
 *
 * Provides structured error types for provider failures, enabling
 * better UX (targeted messages) and programmatic error handling.
 * These complement the existing classifyAPIError() string-based system
 * and can be adopted incrementally.
 */

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export class FreeclaudeError extends Error {
  constructor(
    message: string,
    public readonly category: string,
    public readonly recoverable: boolean,
    public readonly suggestions: string[] = [],
  ) {
    super(message)
    this.name = 'FreeclaudeError'
  }
}

// ---------------------------------------------------------------------------
// Authentication / Authorization
// ---------------------------------------------------------------------------

export class AuthenticationError extends FreeclaudeError {
  constructor(provider: string, detail?: string) {
    super(
      `Authentication failed for provider "${provider}"${detail ? `: ${detail}` : ''}`,
      'authentication',
      false,
      [
        `Check your API key for ${provider} in ~/.freeclaude.json or environment variables`,
        'Run "freeclaude /doctor" to validate provider configuration',
      ],
    )
    this.name = 'AuthenticationError'
  }
}

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

export class RateLimitError extends FreeclaudeError {
  constructor(
    provider: string,
    public readonly retryAfterMs?: number,
  ) {
    super(
      `Rate limit exceeded for "${provider}"${retryAfterMs ? ` (retry after ${Math.ceil(retryAfterMs / 1000)}s)` : ''}`,
      'rate_limit',
      true,
      [
        'Wait a moment and try again',
        'Consider adding more providers to ~/.freeclaude.json for automatic fallback',
      ],
    )
    this.name = 'RateLimitError'
  }
}

// ---------------------------------------------------------------------------
// Network / Connectivity
// ---------------------------------------------------------------------------

export class NetworkError extends FreeclaudeError {
  constructor(
    provider: string,
    public readonly errorCode?: string,
  ) {
    const codeHint = errorCode ? ` (${errorCode})` : ''
    super(
      `Cannot reach provider "${provider}"${codeHint}`,
      'network',
      true,
      [
        `Check your internet connection and that ${provider} is online`,
        'For local providers (Ollama), verify the server is running',
        'Run "freeclaude /doctor" to diagnose connectivity',
      ],
    )
    this.name = 'NetworkError'
  }
}

// ---------------------------------------------------------------------------
// Provider Service Error (5xx)
// ---------------------------------------------------------------------------

export class ProviderServiceError extends FreeclaudeError {
  constructor(
    provider: string,
    public readonly statusCode: number,
  ) {
    super(
      `Provider "${provider}" returned server error (HTTP ${statusCode})`,
      'provider_service',
      true,
      [
        'The provider may be experiencing issues — try again shortly',
        'FreeClaude will automatically fall back to the next configured provider',
      ],
    )
    this.name = 'ProviderServiceError'
  }
}

// ---------------------------------------------------------------------------
// All Providers Exhausted
// ---------------------------------------------------------------------------

export interface ProviderFailureDetail {
  provider: string
  model: string
  error: string
}

export class AllProvidersExhaustedError extends FreeclaudeError {
  constructor(public readonly failures: ProviderFailureDetail[]) {
    const details = failures
      .map(f => `  • ${f.provider} (${f.model}): ${f.error}`)
      .join('\n')
    super(
      `All ${failures.length} providers failed:\n${details}`,
      'all_providers_exhausted',
      false,
      [
        'Check your API keys and provider URLs in ~/.freeclaude.json',
        'Run "freeclaude /doctor" to diagnose connectivity',
        'Try a different provider with "/model provider/model"',
      ],
    )
    this.name = 'AllProvidersExhaustedError'
  }
}

// ---------------------------------------------------------------------------
// Agent Nesting
// ---------------------------------------------------------------------------

export class AgentNestingError extends FreeclaudeError {
  constructor(agentType: string, currentDepth: number, maxDepth: number) {
    super(
      `Agent nesting depth limit reached (${currentDepth}/${maxDepth}). ` +
      `Refusing to spawn "${agentType}" to prevent infinite recursion.`,
      'agent_nesting',
      false,
      ['Execute the task directly instead of delegating to a sub-agent'],
    )
    this.name = 'AgentNestingError'
  }
}
