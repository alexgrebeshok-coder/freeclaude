type AwaySummaryMessage = {
  type: 'user' | 'system' | string
  isMeta?: boolean
  isCompactSummary?: boolean
  subtype?: string
}

export function hasSummarySinceLastUserTurn(
  messages: readonly AwaySummaryMessage[],
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type === 'user' && !m.isMeta && !m.isCompactSummary) return false
    if (m.type === 'system' && m.subtype === 'away_summary') return true
  }
  return false
}
