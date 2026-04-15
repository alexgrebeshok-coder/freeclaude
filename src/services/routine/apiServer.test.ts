import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRoutine } from './store.ts'
import {
  handleRoutineApiRequest,
  ROUTINE_API_DEFAULT_HOST,
  startRoutineApiServer,
  stopRoutineApiServer,
} from './apiServer.ts'

let testHome = ''

beforeEach(() => {
  testHome = join(
    tmpdir(),
    `freeclaude-routine-api-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  process.env.FREECLAUDE_HOME = testHome
})

afterEach(async () => {
  await stopRoutineApiServer()
  rmSync(testHome, { recursive: true, force: true })
  delete process.env.FREECLAUDE_HOME
})

describe('routine api server', () => {
  test('health endpoint reports routine counts', async () => {
    createRoutine({
      name: 'API triage',
      prompt: 'Watch inbound alerts.',
      apiEnabled: true,
    })

    const response = await handleRoutineApiRequest({
      method: 'GET',
      pathname: '/health',
    })

    expect(response.status).toBe(200)
    expect(response.body).toContain('"apiEnabledRoutines":1')
  })

  test('run endpoint rejects missing bearer token', async () => {
    const routine = createRoutine({
      name: 'Webhook triage',
      prompt: 'Read incoming webhook payload.',
      apiEnabled: true,
    })

    const response = await handleRoutineApiRequest({
      method: 'POST',
      pathname: `/routines/${routine.id}/run`,
    })

    expect(response.status).toBe(401)
    expect(response.body).toContain('Missing bearer token')
  })

  test('run endpoint validates token and passes context', async () => {
    const routine = createRoutine({
      name: 'Incident bot',
      prompt: 'Triage incidents.',
      apiEnabled: true,
    })

    const calls: Array<{ id: string; context?: string }> = []
    const response = await handleRoutineApiRequest({
      method: 'POST',
      pathname: `/routines/${routine.id}/run`,
      headers: {
        authorization: `Bearer ${routine.triggers.api.token}`,
      },
      bodyText: JSON.stringify({ context: 'payload: severity=critical' }),
      startRun: input => {
        calls.push({
          id: input.routineIdOrName,
          context: input.extraContext,
        })
        return {
          routine,
          run: {
            id: 'run_test',
            routineId: routine.id,
            routineName: routine.name,
            trigger: 'api',
            status: 'started',
            createdAt: new Date().toISOString(),
          },
          taskId: 'task_test',
          taskShortId: 'task_tes',
        }
      },
    })

    expect(response.status).toBe(202)
    expect(calls).toEqual([
      {
        id: routine.id,
        context: 'payload: severity=critical',
      },
    ])
    expect(response.body).toContain('"runId":"run_test"')
  })

  test('github endpoint validates signature and repo filter', async () => {
    const routine = createRoutine({
      name: 'PR triage',
      prompt: 'Handle pull requests.',
      githubEvent: 'pull_request',
      repos: ['alexgrebeshok-coder/freeclaude'],
    })
    const payload = JSON.stringify({
      action: 'opened',
      repository: {
        full_name: 'alexgrebeshok-coder/freeclaude',
      },
      pull_request: {
        number: 42,
      },
    })
    const signature =
      'sha256=' +
      createHmac('sha256', routine.triggers.github.secret!)
        .update(payload)
        .digest('hex')

    const calls: string[] = []
    const response = await handleRoutineApiRequest({
      method: 'POST',
      pathname: `/github/${routine.id}`,
      headers: {
        'x-github-event': 'pull_request',
        'x-hub-signature-256': signature,
      },
      bodyText: payload,
      startRun: input => {
        calls.push(input.extraContext ?? '')
        return {
          routine,
          run: {
            id: 'run_github',
            routineId: routine.id,
            routineName: routine.name,
            trigger: 'github',
            status: 'started',
            createdAt: new Date().toISOString(),
          },
          taskId: 'task_github',
          taskShortId: 'task_git',
        }
      },
    })

    expect(response.status).toBe(202)
    expect(calls[0]).toContain('GitHub event: pull_request')
    expect(calls[0]).toContain('Repository: alexgrebeshok-coder/freeclaude')
  })

  test('github endpoint rejects invalid signatures', async () => {
    const routine = createRoutine({
      name: 'Bad signature',
      prompt: 'Reject invalid webhook.',
      githubEvent: 'push',
    })

    const response = await handleRoutineApiRequest({
      method: 'POST',
      pathname: `/github/${routine.id}`,
      headers: {
        'x-github-event': 'push',
        'x-hub-signature-256': 'sha256=deadbeef',
      },
      bodyText: JSON.stringify({
        repository: { full_name: 'alexgrebeshok-coder/freeclaude' },
      }),
    })

    expect(response.status).toBe(401)
    expect(response.body).toContain('Invalid GitHub webhook signature')
  })

  test('server starts on loopback and answers health requests', async () => {
    const status = await startRoutineApiServer({ port: 0 })

    expect(status.running).toBe(true)
    expect(status.host).toBe(ROUTINE_API_DEFAULT_HOST)
    expect(status.port).not.toBeNull()

    const response = await fetch(`${status.url}/health`)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
  })
})
