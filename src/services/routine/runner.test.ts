import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRoutine, listRoutineRuns, recordRoutineRun } from './store.ts'
import { RoutineRunBlockedError, startRoutineRun } from './runner.ts'

let testHome = ''

beforeEach(() => {
  testHome = join(
    tmpdir(),
    `freeclaude-routine-runner-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  process.env.FREECLAUDE_HOME = testHome
})

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true })
  delete process.env.FREECLAUDE_HOME
})

describe('routine runner', () => {
  test('startRoutineRun records schedule context and execution metadata', () => {
    const routine = createRoutine({
      name: 'Nightly triage',
      prompt: 'Read new issues.',
      provider: 'zai',
      model: 'glm-5',
    })

    const started = startRoutineRun(
      {
        routineIdOrName: routine.id,
        trigger: 'schedule',
      },
      {
        now: () => new Date('2026-04-15T02:00:00.000Z'),
        createTaskImpl: (prompt, options) => {
          expect(prompt).toContain('Scheduled run at 2026-04-15T02:00:00.000Z')
          expect(options.cwd).toBe(process.cwd())
          expect(options.useWorktree).toBe(true)
          return { id: 'task_123' } as never
        },
        spawnTaskWorkerImpl: taskId =>
          ({
            id: taskId,
            shortId: 'task123',
          }) as never,
      },
    )

    expect(started.taskShortId).toBe('task123')
    expect(started.run).toMatchObject({
      trigger: 'schedule',
      taskId: 'task_123',
      taskShortId: 'task123',
      provider: 'zai',
      model: 'glm-5',
      note: 'Scheduled run at 2026-04-15T02:00:00.000Z',
    })
    expect(listRoutineRuns(routine.id)[0]).toMatchObject({
      taskShortId: 'task123',
      provider: 'zai',
      model: 'glm-5',
    })
  })

  test('startRoutineRun rejects disabled routines and records a failed attempt', () => {
    const routine = createRoutine({
      name: 'Disabled bot',
      prompt: 'Do not run.',
      enabled: false,
    })

    expect(() =>
      startRoutineRun({
        routineIdOrName: routine.id,
        trigger: 'manual',
      }),
    ).toThrow(RoutineRunBlockedError)

    expect(listRoutineRuns(routine.id)[0]).toMatchObject({
      trigger: 'manual',
      status: 'failed',
      note: `Routine "${routine.name}" is disabled`,
    })
  })

  test('startRoutineRun enforces maxRunsPerDay across routine triggers', () => {
    const routine = createRoutine({
      name: 'Capped bot',
      prompt: 'Run at most once.',
      maxRunsPerDay: 1,
    })

    recordRoutineRun({
      routineId: routine.id,
      routineName: routine.name,
      trigger: 'manual',
      status: 'started',
      taskId: 'task_existing',
      createdAt: '2026-04-15T00:30:00.000Z',
    })

    expect(() =>
      startRoutineRun(
        {
          routineIdOrName: routine.id,
          trigger: 'api',
          extraContext: 'payload: severity=critical',
        },
        {
          now: () => new Date('2026-04-15T12:00:00.000Z'),
        },
      ),
    ).toThrow(RoutineRunBlockedError)

    expect(listRoutineRuns(routine.id)[0]?.note).toContain('reached maxRunsPerDay (1)')
  })
})
