import { describe, test, expect, beforeEach } from 'bun:test'

describe('Context Degradation', () => {
  beforeEach(async () => {
    const { resetDegradationState } = await import('./degradation.ts')
    resetDegradationState()
  })

  test('no alerts for clean conversation', async () => {
    const { checkDegradation } = await import('./degradation.ts')

    const alerts = checkDegradation(
      'Hello, how are you?',
      'I am doing great!',
      1000,
      200_000,
    )

    expect(alerts.length).toBe(0)
  })

  test('detects context pressure at 75%+', async () => {
    const { checkDegradation } = await import('./degradation.ts')

    const alerts = checkDegradation(
      'Hello',
      'Response',
      160_000,
      200_000,
    )

    const pressureAlert = alerts.find(a => a.signal === 'context_pressure')
    expect(pressureAlert).toBeTruthy()
    expect(pressureAlert!.severity).toBe('warning')
  })

  test('detects critical context pressure at 95%+', async () => {
    const { checkDegradation } = await import('./degradation.ts')

    const alerts = checkDegradation(
      'Hello',
      'Response',
      195_000,
      200_000,
    )

    const pressureAlert = alerts.find(a => a.signal === 'context_pressure')
    expect(pressureAlert).toBeTruthy()
    expect(pressureAlert!.severity).toBe('critical')
  })

  test('detects circular conversation', async () => {
    const { checkDegradation } = await import('./degradation.ts')

    const sameMessage = 'Please fix the build error'
    const recentMessages = [sameMessage, sameMessage, sameMessage]

    const alerts = checkDegradation(
      sameMessage,
      'Trying again...',
      1000,
      200_000,
      recentMessages,
    )

    const circularAlert = alerts.find(a => a.signal === 'circular_conversation')
    expect(circularAlert).toBeTruthy()
  })

  test('detects long session', async () => {
    const { checkDegradation, resetDegradationState } = await import('./degradation.ts')
    resetDegradationState()

    // Simulate 50 turns
    let longAlert = null
    for (let i = 0; i < 50; i++) {
      const alerts = checkDegradation(`Turn ${i}`, `Response ${i}`, 1000, 200_000)
      if (alerts.find(a => a.signal === 'long_session')) {
        longAlert = alerts.find(a => a.signal === 'long_session')
      }
    }

    expect(longAlert).toBeTruthy()
    expect(longAlert!.severity).toBe('info')
  })

  test('formatDegradationAlerts shows clean state', async () => {
    const { formatDegradationAlerts, resetDegradationState } = await import('./degradation.ts')
    resetDegradationState()

    const output = formatDegradationAlerts()
    expect(output).toContain('No degradation signals')
  })

  test('getDegradationState tracks turns', async () => {
    const { checkDegradation, getDegradationState, resetDegradationState } = await import('./degradation.ts')
    resetDegradationState()

    checkDegradation('msg1', 'resp1', 1000, 200_000)
    checkDegradation('msg2', 'resp2', 1000, 200_000)

    const state = getDegradationState()
    expect(state.turnCount).toBe(2)
  })
})
