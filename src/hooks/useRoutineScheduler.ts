import { useEffect } from 'react'

import { startRoutineRun } from '../services/routine/runner.js'
import { createRoutineScheduler } from '../services/routine/scheduler.js'
import { logForDebugging } from '../utils/debug.js'

export function useRoutineScheduler(): void {
  useEffect(() => {
    const scheduler = createRoutineScheduler({
      runRoutine: async routine => {
        startRoutineRun({
          routineIdOrName: routine.id,
          trigger: 'schedule',
        })
      },
      onError: (routine, error) => {
        logForDebugging(
          `[RoutineScheduler] failed to start "${routine.name}": ${error.message}`,
        )
      },
    })

    scheduler.start()
    return () => scheduler.stop()
  }, [])
}
