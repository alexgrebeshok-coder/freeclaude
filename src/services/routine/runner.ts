import {
  createTask,
  spawnTaskWorker,
} from '../tasks/taskManager.js'
import {
  buildRoutinePrompt,
  getRoutine,
  listRoutineRuns,
  recordRoutineRun,
  type RoutineRecord,
  type RoutineRunRecord,
  updateRoutine,
} from './store.js'

export interface StartRoutineRunInput {
  routineIdOrName: string
  trigger: RoutineRunRecord['trigger']
  extraContext?: string
  note?: string
  cwd?: string
  useWorktree?: boolean
}

export interface StartRoutineRunOptions {
  createTaskImpl?: typeof createTask
  spawnTaskWorkerImpl?: typeof spawnTaskWorker
  now?: () => Date
}

export interface StartedRoutineRun {
  routine: RoutineRecord
  run: RoutineRunRecord
  taskId: string
  taskShortId: string
}

export class RoutineRunBlockedError extends Error {}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function startOfLocalDay(date: Date): number {
  const rounded = new Date(date)
  rounded.setHours(0, 0, 0, 0)
  return rounded.getTime()
}

function countExecutableRunsToday(
  routineId: string,
  at: Date,
): number {
  const dayStartMs = startOfLocalDay(at)
  return listRoutineRuns(routineId).filter(run => {
    if (Date.parse(run.createdAt) < dayStartMs) {
      return false
    }
    return Boolean(run.taskId) || run.status === 'started' || run.status === 'completed'
  }).length
}

function buildAutomaticContext(
  trigger: RoutineRunRecord['trigger'],
  now: Date,
): string | undefined {
  return trigger === 'schedule'
    ? `Scheduled run at ${now.toISOString()}`
    : undefined
}

function summarizeRunNote(text: string | undefined): string | undefined {
  if (!text?.trim()) {
    return undefined
  }

  const summary = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' | ')

  if (!summary) {
    return undefined
  }

  return summary.length > 240 ? `${summary.slice(0, 237)}...` : summary
}

function assertRoutineCanRun(
  routine: RoutineRecord,
  at: Date,
): void {
  if (!routine.enabled) {
    throw new RoutineRunBlockedError(`Routine "${routine.name}" is disabled`)
  }

  const runsToday = countExecutableRunsToday(routine.id, at)
  if (runsToday >= routine.maxRunsPerDay) {
    throw new RoutineRunBlockedError(
      `Routine "${routine.name}" reached maxRunsPerDay (${routine.maxRunsPerDay})`,
    )
  }
}

export function startRoutineRun(
  input: StartRoutineRunInput,
  options: StartRoutineRunOptions = {},
): StartedRoutineRun {
  const routine = getRoutine(input.routineIdOrName)
  const now = options.now?.() ?? new Date()
  const extraContext = input.extraContext?.trim() || buildAutomaticContext(input.trigger, now)
  const note = input.note?.trim() || summarizeRunNote(extraContext)
  const createTaskImpl = options.createTaskImpl ?? createTask
  const spawnTaskWorkerImpl = options.spawnTaskWorkerImpl ?? spawnTaskWorker

  try {
    assertRoutineCanRun(routine, now)

    const prompt = buildRoutinePrompt(routine, extraContext)
    const task = createTaskImpl(prompt, {
      cwd: input.cwd ?? process.cwd(),
      template: 'custom',
      useWorktree: input.useWorktree ?? true,
    })
    const spawned = spawnTaskWorkerImpl(task.id)
    const run = recordRoutineRun({
      routineId: routine.id,
      routineName: routine.name,
      trigger: input.trigger,
      status: 'started',
      taskId: spawned.id,
      taskShortId: spawned.shortId,
      provider: routine.provider,
      model: routine.model,
      note,
    })
    updateRoutine(routine.id, { lastRun: run.createdAt })

    return {
      routine,
      run,
      taskId: spawned.id,
      taskShortId: spawned.shortId,
    }
  } catch (error) {
    recordRoutineRun({
      routineId: routine.id,
      routineName: routine.name,
      trigger: input.trigger,
      status: 'failed',
      provider: routine.provider,
      model: routine.model,
      note: note
        ? `${note} — ${toErrorMessage(error)}`
        : toErrorMessage(error),
    })
    throw error
  }
}
