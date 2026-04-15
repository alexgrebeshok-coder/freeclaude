/**
 * FreeClaude v3 — Context Degradation Detector
 *
 * Detects when context quality drops during a session:
 * - Repeated errors (model hitting same issue)
 * - Circular conversations (going in circles)
 * - Nonsensical responses (output quality degradation)
 * - Context window pressure (approaching limits)
 *
 * Provides actionable suggestions: compact, new session, or model switch.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DegradationSignal =
  | 'repeated_errors'
  | 'circular_conversation'
  | 'context_pressure'
  | 'long_session'

export type DegradationSeverity = 'info' | 'warning' | 'critical'

export interface DegradationAlert {
  signal: DegradationSignal
  severity: DegradationSeverity
  message: string
  suggestion: string
  detectedAt: string
}

export interface DegradationState {
  alerts: DegradationAlert[]
  errorHistory: string[]
  turnCount: number
  sessionStartedAt: string
}

// ---------------------------------------------------------------------------
// Detection config
// ---------------------------------------------------------------------------

const REPEATED_ERROR_THRESHOLD = 3       // Same error 3+ times
const CIRCULAR_THRESHOLD = 3             // Same user message 3+ times
const LONG_SESSION_TURNS = 50            // 50+ turns
const CONTEXT_PRESSURE_PERCENT = 75      // 75% of window used

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _state: DegradationState = {
  alerts: [],
  errorHistory: [],
  turnCount: 0,
  sessionStartedAt: new Date().toISOString(),
}

/**
 * Reset degradation state (new session).
 */
export function resetDegradationState(): void {
  _state = {
    alerts: [],
    errorHistory: [],
    turnCount: 0,
    sessionStartedAt: new Date().toISOString(),
  }
}

/**
 * Get current degradation state.
 */
export function getDegradationState(): DegradationState {
  return { ..._state }
}

// ---------------------------------------------------------------------------
// Signal detection
// ---------------------------------------------------------------------------

/**
 * Record a turn and check for degradation signals.
 * Call this after each assistant response.
 */
export function checkDegradation(
  userMessage: string,
  assistantResponse: string,
  currentTokens: number,
  maxTokens: number,
  recentUserMessages: string[] = [],
): DegradationAlert[] {
  const newAlerts: DegradationAlert[] = []
  _state.turnCount++

  // 1. Check for repeated errors
  const errorAlert = detectRepeatedErrors(assistantResponse)
  if (errorAlert) newAlerts.push(errorAlert)

  // 2. Check for circular conversation
  const circularAlert = detectCircularConversation(userMessage, recentUserMessages)
  if (circularAlert) newAlerts.push(circularAlert)

  // 3. Check context pressure
  const pressureAlert = detectContextPressure(currentTokens, maxTokens)
  if (pressureAlert) newAlerts.push(pressureAlert)

  // 4. Check long session
  const longAlert = detectLongSession()
  if (longAlert) newAlerts.push(longAlert)

  // Add new alerts (avoid duplicates by signal type)
  for (const alert of newAlerts) {
    const existing = _state.alerts.find(a =>
      a.signal === alert.signal && a.severity === alert.severity,
    )
    if (!existing) {
      _state.alerts.push(alert)
    }
  }

  return newAlerts
}

function detectRepeatedErrors(response: string): DegradationAlert | null {
  // Extract error patterns from response
  const errorPatterns = [
    /error[:\s]+(.{10,60})/i,
    /failed[:\s]+(.{10,60})/i,
    /cannot\s+(.{10,60})/i,
    /ошибка[:\s]+(.{10,60})/i,
  ]

  for (const pattern of errorPatterns) {
    const match = response.match(pattern)
    if (match) {
      const errorKey = match[1]!.trim().toLowerCase().slice(0, 40)
      _state.errorHistory.push(errorKey)

      // Count occurrences of this error
      const count = _state.errorHistory.filter(e => e === errorKey).length
      if (count >= REPEATED_ERROR_THRESHOLD) {
        return {
          signal: 'repeated_errors',
          severity: count >= 5 ? 'critical' : 'warning',
          message: `Same error repeated ${count} times: "${errorKey}"`,
          suggestion: 'Try a different approach or start a new session',
          detectedAt: new Date().toISOString(),
        }
      }
    }
  }

  // Keep error history manageable
  if (_state.errorHistory.length > 50) {
    _state.errorHistory = _state.errorHistory.slice(-30)
  }

  return null
}

function detectCircularConversation(
  currentMessage: string,
  recentMessages: string[],
): DegradationAlert | null {
  if (!currentMessage || currentMessage.length < 10) return null

  const normalized = currentMessage.trim().toLowerCase()
  const count = recentMessages.filter(m =>
    m.trim().toLowerCase() === normalized,
  ).length

  if (count >= CIRCULAR_THRESHOLD) {
    return {
      signal: 'circular_conversation',
      severity: 'warning',
      message: `Same request repeated ${count + 1} times`,
      suggestion: 'Rephrase your request or try a different approach',
      detectedAt: new Date().toISOString(),
    }
  }

  return null
}

function detectContextPressure(
  currentTokens: number,
  maxTokens: number,
): DegradationAlert | null {
  if (maxTokens <= 0) return null

  const usagePercent = (currentTokens / maxTokens) * 100

  if (usagePercent >= 95) {
    return {
      signal: 'context_pressure',
      severity: 'critical',
      message: `Context window ${usagePercent.toFixed(0)}% full (${currentTokens.toLocaleString()}/${maxTokens.toLocaleString()} tokens)`,
      suggestion: 'Context will be auto-compacted. Consider starting a new session.',
      detectedAt: new Date().toISOString(),
    }
  }

  if (usagePercent >= CONTEXT_PRESSURE_PERCENT) {
    return {
      signal: 'context_pressure',
      severity: 'warning',
      message: `Context window ${usagePercent.toFixed(0)}% full`,
      suggestion: 'Consider using /compact to summarize older messages',
      detectedAt: new Date().toISOString(),
    }
  }

  return null
}

function detectLongSession(): DegradationAlert | null {
  if (_state.turnCount === LONG_SESSION_TURNS) {
    return {
      signal: 'long_session',
      severity: 'info',
      message: `Session has ${_state.turnCount} turns`,
      suggestion: 'Long sessions may degrade quality. Consider starting fresh.',
      detectedAt: new Date().toISOString(),
    }
  }

  if (_state.turnCount === LONG_SESSION_TURNS * 2) {
    return {
      signal: 'long_session',
      severity: 'warning',
      message: `Very long session: ${_state.turnCount} turns`,
      suggestion: 'Strongly recommend starting a new session for best results.',
      detectedAt: new Date().toISOString(),
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatDegradationAlerts(): string {
  const alerts = _state.alerts
  if (alerts.length === 0) {
    return '✅ No degradation signals detected'
  }

  const icons: Record<DegradationSeverity, string> = {
    info: 'ℹ️',
    warning: '⚠️',
    critical: '🔴',
  }

  const lines = ['🔍 Context Quality Report', '']
  for (const alert of alerts) {
    lines.push(`   ${icons[alert.severity]} [${alert.signal}] ${alert.message}`)
    lines.push(`      → ${alert.suggestion}`)
    lines.push('')
  }

  lines.push(`   Session: ${_state.turnCount} turns since ${_state.sessionStartedAt}`)
  return lines.join('\n')
}
