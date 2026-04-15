import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRoutine, recordRoutineRun } from '../../services/routine/store.js'
import { createTask, updateTask } from '../../services/tasks/taskManager.js'
import { call } from './routine.ts'

let testHome = ''

beforeEach(() => {
  testHome = join(
    tmpdir(),
    `freeclaude-routine-command-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  process.env.FREECLAUDE_HOME = testHome
})

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true })
  delete process.env.FREECLAUDE_HOME
})

describe('/routine logs', () => {
  test('filters runs by effective status and limit', async () => {
    const routine = createRoutine({
      name: 'Backlog triage',
      prompt: 'Read issues.',
      provider: 'zai',
      model: 'glm-5',
    })

    const completedTask = createTask('completed task')
    updateTask(completedTask.id, {
      status: 'completed',
      summary: 'Backlog was triaged successfully.',
      resultPreview: 'Triaged backlog.',
      provider: 'zai',
      model: 'glm-5',
      updatedAt: '2026-04-15T02:05:00.000Z',
      completedAt: '2026-04-15T02:05:00.000Z',
    })
    recordRoutineRun({
      routineId: routine.id,
      routineName: routine.name,
      trigger: 'schedule',
      status: 'started',
      createdAt: '2026-04-15T02:00:00.000Z',
      taskId: completedTask.id,
      taskShortId: completedTask.shortId,
      provider: 'zai',
      model: 'glm-5',
      note: 'Scheduled run at 2026-04-15T02:00:00.000Z',
    })

    const failedTask = createTask('failed task')
    updateTask(failedTask.id, {
      status: 'failed',
      errorMessage: 'Webhook payload could not be parsed.',
      summary: 'Routine failed during API triage.',
      updatedAt: '2026-04-15T03:05:00.000Z',
      completedAt: '2026-04-15T03:05:00.000Z',
    })
    recordRoutineRun({
      routineId: routine.id,
      routineName: routine.name,
      trigger: 'api',
      status: 'started',
      createdAt: '2026-04-15T03:00:00.000Z',
      taskId: failedTask.id,
      taskShortId: failedTask.shortId,
      note: 'payload: severity=critical',
    })

    const result = await call(`logs ${routine.id} --failed --last 1`)

    expect(result.value).toContain('Routine runs (1 shown')
    expect(result.value).toContain('status: failed')
    expect(result.value).toContain('Routine failed during API triage.')
    expect(result.value).toContain(`task: ${failedTask.shortId}`)
    expect(result.value).not.toContain('Backlog was triaged successfully.')
  })

  test('shows detailed view for a specific run id', async () => {
    const routine = createRoutine({
      name: 'Incident bot',
      prompt: 'Triage incidents.',
      provider: 'zai',
      model: 'glm-5',
    })

    const task = createTask('incident task')
    updateTask(task.id, {
      status: 'failed',
      summary: 'Routine could not finish the incident review.',
      resultPreview: 'Partial incident notes collected.',
      errorMessage: 'Provider timed out while reviewing logs.',
      provider: 'zai',
      model: 'glm-5',
      artifactPath: '/tmp/freeclaude-artifact.md',
      vaultNotePath: '/tmp/freeclaude-note.md',
      updatedAt: '2026-04-15T04:03:00.000Z',
      completedAt: '2026-04-15T04:03:00.000Z',
    })
    const run = recordRoutineRun({
      routineId: routine.id,
      routineName: routine.name,
      trigger: 'github',
      status: 'started',
      createdAt: '2026-04-15T04:00:00.000Z',
      taskId: task.id,
      taskShortId: task.shortId,
      provider: 'zai',
      model: 'glm-5',
      note: 'GitHub event: pull_request | Action: opened',
    })

    const result = await call(`logs --run ${run.id}`)

    expect(result.value).toContain(`Routine run ${run.id}`)
    expect(result.value).toContain(`Task: ${task.shortId}`)
    expect(result.value).toContain('Status: failed')
    expect(result.value).toContain('Summary:')
    expect(result.value).toContain('Provider timed out while reviewing logs.')
    expect(result.value).toContain('/tmp/freeclaude-artifact.md')
    expect(result.value).toContain('/tmp/freeclaude-note.md')
  })
})
