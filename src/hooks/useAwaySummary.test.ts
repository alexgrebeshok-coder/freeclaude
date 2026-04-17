import { describe, expect, test } from 'bun:test'
import { hasSummarySinceLastUserTurn } from './useAwaySummary.helpers.js'

describe('useAwaySummary helpers', () => {
  test('detects away summary when it appears after the last real user turn', () => {
    expect(
      hasSummarySinceLastUserTurn([
        { type: 'user' },
        { type: 'system', subtype: 'away_summary' },
      ]),
    ).toBe(true)
  })

  test('stops at the latest non-meta user turn', () => {
    expect(
      hasSummarySinceLastUserTurn([
        { type: 'system', subtype: 'away_summary' },
        { type: 'user' },
      ]),
    ).toBe(false)

    expect(
      hasSummarySinceLastUserTurn([
        { type: 'user', isMeta: true },
        { type: 'system', subtype: 'away_summary' },
      ]),
    ).toBe(true)
  })
})
