import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createRoutine,
  recordRoutineRun,
} from './store.ts'
import {
  createRoutineScheduler,
  matchesRoutineSchedule,
} from './scheduler.ts'

let testHome = ''

beforeEach(() => {
  testHome = join(
    tmpdir(),
    `freeclaude-routine-scheduler-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  process.env.FREECLAUDE_HOME = testHome
})

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true })
  delete process.env.FREECLAUDE_HOME
})

describe('routine scheduler', () => {
  test('matchesRoutineSchedule checks the local cron minute', () => {
    expect(matchesRoutineSchedule('15 9 * * *', new Date(2025, 0, 1, 9, 15, 0))).toBe(true)
    expect(matchesRoutineSchedule('15 9 * * *', new Date(2025, 0, 1, 9, 16, 0))).toBe(false)
  })

  test('tick runs enabled routines that are due now', async () => {
    const dueAt = new Date(2025, 0, 1, 9, 15, 20)
    const routine = createRoutine({
      name: 'Morning triage',
      prompt: 'Summarize new bugs.',
      schedule: '15 9 * * *',
    })
    const started: string[] = []

    const scheduler = createRoutineScheduler({
      now: () => dueAt,
      runRoutine: async startedRoutine => {
        started.push(startedRoutine.id)
        recordRoutineRun({
          routineId: startedRoutine.id,
          routineName: startedRoutine.name,
          trigger: 'schedule',
          status: 'started',
          createdAt: dueAt.toISOString(),
        })
      },
    })

    await scheduler.tick()

    expect(started).toEqual([routine.id])
  })

  test('tick does not run the same scheduled minute twice', async () => {
    const dueAt = new Date(2025, 0, 1, 9, 15, 5)
    createRoutine({
      name: 'Duplicate guard',
      prompt: 'Only once.',
      schedule: '15 9 * * *',
    })
    const started: string[] = []

    const scheduler = createRoutineScheduler({
      now: () => dueAt,
      runRoutine: async routine => {
        started.push(routine.id)
        recordRoutineRun({
          routineId: routine.id,
          routineName: routine.name,
          trigger: 'schedule',
          status: 'started',
          createdAt: dueAt.toISOString(),
        })
      },
    })

    await scheduler.tick()
    await scheduler.tick()

    expect(started).toHaveLength(1)
  })

  test('tick respects maxRunsPerDay', async () => {
    const dueAt = new Date(2025, 0, 1, 9, 15, 10)
    const routine = createRoutine({
      name: 'Rate limited',
      prompt: 'Stop at one.',
      schedule: '15 9 * * *',
      maxRunsPerDay: 1,
    })

    recordRoutineRun({
      routineId: routine.id,
      routineName: routine.name,
      trigger: 'manual',
      status: 'completed',
      createdAt: new Date(2025, 0, 1, 8, 0, 0).toISOString(),
    })

    const started: string[] = []
    const scheduler = createRoutineScheduler({
      now: () => dueAt,
      runRoutine: async startedRoutine => {
        started.push(startedRoutine.id)
      },
    })

    await scheduler.tick()

    expect(started).toEqual([])
  })

  test('tick skips disabled routines and routines without schedules', async () => {
    createRoutine({
      name: 'Disabled',
      prompt: 'Skip me.',
      schedule: '15 9 * * *',
      enabled: false,
    })
    createRoutine({
      name: 'Manual only',
      prompt: 'Skip me too.',
    })

    const started: string[] = []
    const scheduler = createRoutineScheduler({
      now: () => new Date(2025, 0, 1, 9, 15, 0),
      runRoutine: async routine => {
        started.push(routine.id)
      },
    })

    await scheduler.tick()

    expect(started).toEqual([])
  })
})
