import { describe, expect, test } from 'bun:test'
import { shouldProcessQueue } from './useQueueProcessor.helpers.js'

describe('useQueueProcessor helpers', () => {
  test('processes queue only when nothing is blocking it', () => {
    expect(
      shouldProcessQueue({
        isQueryActive: false,
        hasActiveLocalJsxUI: false,
        queueLength: 2,
      }),
    ).toBe(true)
  })

  test('blocks queue processing for active query, local UI, or empty queue', () => {
    expect(
      shouldProcessQueue({
        isQueryActive: true,
        hasActiveLocalJsxUI: false,
        queueLength: 2,
      }),
    ).toBe(false)
    expect(
      shouldProcessQueue({
        isQueryActive: false,
        hasActiveLocalJsxUI: true,
        queueLength: 2,
      }),
    ).toBe(false)
    expect(
      shouldProcessQueue({
        isQueryActive: false,
        hasActiveLocalJsxUI: false,
        queueLength: 0,
      }),
    ).toBe(false)
  })
})
