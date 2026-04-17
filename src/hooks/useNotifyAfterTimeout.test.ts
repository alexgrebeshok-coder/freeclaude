import { describe, expect, test } from 'bun:test'
import {
  getTimeSinceLastInteraction,
  hasRecentInteraction,
  shouldNotifyAfterTimeout,
} from './useNotifyAfterTimeout.helpers.js'

describe('useNotifyAfterTimeout helpers', () => {
  test('computes elapsed interaction time and recentness', () => {
    expect(getTimeSinceLastInteraction(1000, 2500)).toBe(1500)
    expect(hasRecentInteraction(1000, 2000, 2500)).toBe(true)
    expect(hasRecentInteraction(1000, 1000, 2500)).toBe(false)
  })

  test('suppresses notifications in test env and for recent interaction', () => {
    expect(
      shouldNotifyAfterTimeout({
        nodeEnv: 'test',
        lastInteractionTime: 1000,
        threshold: 2000,
        now: 5000,
      }),
    ).toBe(false)

    expect(
      shouldNotifyAfterTimeout({
        nodeEnv: 'production',
        lastInteractionTime: 4000,
        threshold: 2000,
        now: 5000,
      }),
    ).toBe(false)

    expect(
      shouldNotifyAfterTimeout({
        nodeEnv: 'production',
        lastInteractionTime: 1000,
        threshold: 2000,
        now: 5000,
      }),
    ).toBe(true)
  })
})
