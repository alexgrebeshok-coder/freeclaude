import { describe, expect, test } from 'bun:test'
import { shouldAttemptSpeculativeBashClassifier } from './useCanUseTool.helpers.js'

describe('useCanUseTool helpers', () => {
  test('allows speculative bash classifier only for bash ask flow without dialog wait', () => {
    expect(
      shouldAttemptSpeculativeBashClassifier({
        pendingClassifierCheck: { pending: true },
        toolName: 'Bash',
        awaitAutomatedChecksBeforeDialog: false,
      }),
    ).toBe(true)
  })

  test('disables speculative bash classifier when prerequisites are missing', () => {
    expect(
      shouldAttemptSpeculativeBashClassifier({
        pendingClassifierCheck: undefined,
        toolName: 'Bash',
        awaitAutomatedChecksBeforeDialog: false,
      }),
    ).toBe(false)

    expect(
      shouldAttemptSpeculativeBashClassifier({
        pendingClassifierCheck: { pending: true },
        toolName: 'Read',
        awaitAutomatedChecksBeforeDialog: false,
      }),
    ).toBe(false)

    expect(
      shouldAttemptSpeculativeBashClassifier({
        pendingClassifierCheck: { pending: true },
        toolName: 'Bash',
        awaitAutomatedChecksBeforeDialog: true,
      }),
    ).toBe(false)
  })
})
