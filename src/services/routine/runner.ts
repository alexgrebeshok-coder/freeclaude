import {
  createTask,
  spawnTaskWorker,
} from '../tasks/taskManager.js'
import {
  buildRoutinePrompt,
  getRoutine,
  recordRoutineRun,
  type RoutineRecord,
  type RoutineRunRecord,
  updateRoutine,
} from './store.js'

export interface StartRoutineRunInput {
  routineIdOrName: string
  trigger: RoutineRunRecord['trigger']
  extraContext?: string
  cwd?: string
  useWorktree?: boolean
}

export interface StartedRoutineRun {
  routine: RoutineRecord
  run: RoutineRunRecord
  taskId: string
  taskShortId: string
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function startRoutineRun(
  input: StartRoutineRunInput,
): StartedRoutineRun {
  const routine = getRoutine(input.routineIdOrName)
  const prompt = buildRoutinePrompt(routine, input.extraContext)

  try {
    const task = createTask(prompt, {
      cwd: input.cwd ?? process.cwd(),
      template: 'custom',
      useWorktree: input.useWorktree ?? true,
    })
    const spawned = spawnTaskWorker(task.id)
    const run = recordRoutineRun({
      routineId: routine.id,
      routineName: routine.name,
      trigger: input.trigger,
      status: 'started',
      taskId: spawned.id,
      note: input.extraContext?.trim() || undefined,
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
      note: toErrorMessage(error),
    })
    throw error
  }
}
