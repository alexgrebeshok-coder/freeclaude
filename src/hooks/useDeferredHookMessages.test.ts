import { describe, expect, test } from 'bun:test'
import {
  prependDeferredHookMessages,
  shouldFlushDeferredHookMessages,
} from './useDeferredHookMessages.helpers.js'

describe('useDeferredHookMessages helpers', () => {
  test('prepends deferred messages ahead of existing transcript', () => {
    expect(prependDeferredHookMessages(['existing'], ['hook-a', 'hook-b'])).toEqual([
      'hook-a',
      'hook-b',
      'existing',
    ])
    expect(prependDeferredHookMessages(['existing'], [])).toEqual(['existing'])
  })

  test('flushes only while unresolved promise still exists', () => {
    expect(
      shouldFlushDeferredHookMessages({
        resolved: false,
        hasPendingPromise: true,
      }),
    ).toBe(true)
    expect(
      shouldFlushDeferredHookMessages({
        resolved: true,
        hasPendingPromise: true,
      }),
    ).toBe(false)
    expect(
      shouldFlushDeferredHookMessages({
        resolved: false,
        hasPendingPromise: false,
      }),
    ).toBe(false)
  })
})
