import { parseCronExpression } from '../../utils/cron.js'
import {
  listRoutineRuns,
  listRoutines,
  type RoutineRecord,
  type RoutineRunRecord,
} from './store.js'

const DEFAULT_INTERVAL_MS = 30_000
const RECENT_RUN_LIMIT = 1000

export interface RoutineSchedulerOptions {
  intervalMs?: number
  now?: () => Date
  runRoutine: (routine: RoutineRecord) => Promise<void> | void
  onError?: (routine: RoutineRecord, error: Error) => void
}

export interface RoutineScheduler {
  start: () => void
  stop: () => void
  tick: () => Promise<void>
  isRunning: () => boolean
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function startOfMinute(date: Date): number {
  const rounded = new Date(date)
  rounded.setSeconds(0, 0)
  return rounded.getTime()
}

function startOfLocalDay(date: Date): number {
  const rounded = new Date(date)
  rounded.setHours(0, 0, 0, 0)
  return rounded.getTime()
}

export function matchesRoutineSchedule(
  schedule: string,
  at: Date,
): boolean {
  const fields = parseCronExpression(schedule)
  if (!fields) return false

  const minute = at.getMinutes()
  const hour = at.getHours()
  const dayOfMonth = at.getDate()
  const month = at.getMonth() + 1
  const dayOfWeek = at.getDay()

  if (
    !fields.minute.includes(minute) ||
    !fields.hour.includes(hour) ||
    !fields.month.includes(month)
  ) {
    return false
  }

  const domWild = fields.dayOfMonth.length === 31
  const dowWild = fields.dayOfWeek.length === 7
  const domMatch = fields.dayOfMonth.includes(dayOfMonth)
  const dowMatch = fields.dayOfWeek.includes(dayOfWeek)

  return domWild && dowWild
    ? true
    : domWild
      ? dowMatch
      : dowWild
        ? domMatch
        : domMatch || dowMatch
}

function hasScheduledRunInWindow(
  routineId: string,
  runs: RoutineRunRecord[],
  windowStartMs: number,
): boolean {
  const windowEndMs = windowStartMs + 60_000
  return runs.some(run => {
    if (run.routineId !== routineId || run.trigger !== 'schedule') {
      return false
    }
    const createdAt = Date.parse(run.createdAt)
    return createdAt >= windowStartMs && createdAt < windowEndMs
  })
}

function countRoutineRunsToday(
  routineId: string,
  runs: RoutineRunRecord[],
  dayStartMs: number,
): number {
  return runs.filter(run => {
    if (run.routineId !== routineId) {
      return false
    }
    return Date.parse(run.createdAt) >= dayStartMs
  }).length
}

export function createRoutineScheduler(
  options: RoutineSchedulerOptions,
): RoutineScheduler {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    now = () => new Date(),
    runRoutine,
    onError,
  } = options

  let timer: ReturnType<typeof setInterval> | null = null
  let ticking = false
  const attemptedMinuteKeys = new Set<string>()

  async function tick(): Promise<void> {
    if (ticking) return
    ticking = true

    try {
      const current = now()
      const minuteStartMs = startOfMinute(current)
      const dayStartMs = startOfLocalDay(current)
      const runs = listRoutineRuns(undefined, RECENT_RUN_LIMIT)
      const routines = listRoutines().filter(
        routine => routine.enabled && Boolean(routine.triggers.schedule),
      )

      for (const routine of routines) {
        const schedule = routine.triggers.schedule
        if (!schedule || !matchesRoutineSchedule(schedule, current)) {
          continue
        }

        const attemptKey = `${routine.id}:${minuteStartMs}`
        if (attemptedMinuteKeys.has(attemptKey)) {
          continue
        }
        if (hasScheduledRunInWindow(routine.id, runs, minuteStartMs)) {
          attemptedMinuteKeys.add(attemptKey)
          continue
        }
        if (
          countRoutineRunsToday(routine.id, runs, dayStartMs) >=
          routine.maxRunsPerDay
        ) {
          attemptedMinuteKeys.add(attemptKey)
          continue
        }

        attemptedMinuteKeys.add(attemptKey)

        try {
          await runRoutine(routine)
        } catch (error) {
          onError?.(routine, toError(error))
        }
      }
    } finally {
      ticking = false
    }
  }

  return {
    start() {
      if (timer) return
      timer = setInterval(() => {
        void tick()
      }, intervalMs)
      void tick()
    },
    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    },
    tick,
    isRunning() {
      return timer !== null
    },
  }
}
