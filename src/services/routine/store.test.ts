import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildRoutinePrompt,
  createRoutine,
  deleteRoutine,
  generateRoutineToken,
  getRoutine,
  getRoutineConfigPath,
  listRoutineRuns,
  listRoutines,
  loadRoutineFile,
  recordRoutineRun,
  setRoutineEnabled,
  updateRoutine,
} from './store.ts'

let testHome = ''

beforeEach(() => {
  testHome = join(
    tmpdir(),
    `freeclaude-routines-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  process.env.FREECLAUDE_HOME = testHome
})

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true })
  delete process.env.FREECLAUDE_HOME
})

describe('routine store', () => {
  test('loadRoutineFile returns empty state when missing', () => {
    expect(loadRoutineFile()).toEqual({ routines: [] })
  })

  test('createRoutine persists a minimal routine', () => {
    const routine = createRoutine({
      name: 'Nightly bug fix',
      prompt: 'Read the top bug and attempt a fix.',
    })

    expect(routine.id).toMatch(/^rtn_/)
    expect(routine.enabled).toBe(true)
    expect(routine.triggers.schedule).toBeNull()
    expect(existsSync(getRoutineConfigPath())).toBe(true)
  })

  test('createRoutine generates API token when API trigger is enabled', () => {
    const routine = createRoutine({
      name: 'API triage',
      prompt: 'Analyze inbound alert payloads.',
      apiEnabled: true,
    })

    expect(routine.triggers.api.enabled).toBe(true)
    expect(routine.triggers.api.token).toMatch(/^fc_tok_/)
  })

  test('createRoutine rejects duplicate names', () => {
    createRoutine({ name: 'Duplicate', prompt: 'One' })
    expect(() =>
      createRoutine({ name: 'duplicate', prompt: 'Two' }),
    ).toThrow(/already exists/)
  })

  test('createRoutine validates cron schedules', () => {
    expect(() =>
      createRoutine({
        name: 'Broken cron',
        prompt: 'Nope',
        schedule: '0 2 * *',
      }),
    ).toThrow(/5-field cron/)
  })

  test('updateRoutine patches schedule, provider, model, and repos', () => {
    const routine = createRoutine({
      name: 'Weekly docs',
      prompt: 'Check docs drift.',
    })

    const updated = updateRoutine(routine.id, {
      schedule: '0 9 * * 1',
      provider: 'zai',
      model: 'glm-5',
      repos: ['alexgrebeshok-coder/freeclaude'],
      maxRunsPerDay: 2,
    })

    expect(updated.triggers.schedule).toBe('0 9 * * 1')
    expect(updated.provider).toBe('zai')
    expect(updated.model).toBe('glm-5')
    expect(updated.repos).toEqual(['alexgrebeshok-coder/freeclaude'])
    expect(updated.maxRunsPerDay).toBe(2)
  })

  test('setRoutineEnabled toggles the routine state', () => {
    const routine = createRoutine({
      name: 'Toggle me',
      prompt: 'Toggle.',
    })

    expect(setRoutineEnabled(routine.id, false).enabled).toBe(false)
    expect(setRoutineEnabled(routine.id, true).enabled).toBe(true)
  })

  test('getRoutine resolves by name and partial id', () => {
    const routine = createRoutine({
      name: 'Manual runner',
      prompt: 'Run manually.',
    })

    expect(getRoutine('Manual runner').id).toBe(routine.id)
    expect(getRoutine(routine.id.slice(0, 6)).id).toBe(routine.id)
  })

  test('deleteRoutine removes the entry', () => {
    const routine = createRoutine({
      name: 'Delete me',
      prompt: 'Delete.',
    })

    expect(deleteRoutine(routine.id).id).toBe(routine.id)
    expect(listRoutines()).toEqual([])
  })

  test('recordRoutineRun persists runs and listRoutineRuns filters by routine', () => {
    const one = createRoutine({ name: 'One', prompt: 'One.' })
    const two = createRoutine({ name: 'Two', prompt: 'Two.' })

    recordRoutineRun({
      routineId: one.id,
      routineName: one.name,
      trigger: 'manual',
      status: 'started',
      taskId: 'task-1',
    })
    recordRoutineRun({
      routineId: two.id,
      routineName: two.name,
      trigger: 'manual',
      status: 'started',
      taskId: 'task-2',
    })

    expect(listRoutineRuns().length).toBe(2)
    expect(listRoutineRuns(one.id).map(run => run.taskId)).toEqual(['task-1'])
  })

  test('buildRoutinePrompt includes routine metadata and extra context', () => {
    const routine = createRoutine({
      name: 'Backlog triage',
      prompt: 'Read new issues and label them.',
      provider: 'zai',
      model: 'glm-5',
      repos: ['alexgrebeshok-coder/freeclaude'],
    })

    const prompt = buildRoutinePrompt(
      routine,
      'Incoming payload: PR #42 touches auth and billing.',
    )

    expect(prompt).toContain('Routine: Backlog triage')
    expect(prompt).toContain('Provider: zai')
    expect(prompt).toContain('Repositories: alexgrebeshok-coder/freeclaude')
    expect(prompt).toContain('Incoming payload: PR #42')
  })
})
