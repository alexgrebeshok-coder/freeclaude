import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  appendTaskEvent,
  createTask,
  listTasks,
  readTaskEvents,
  type TaskTemplateId,
} from './taskManager.ts'
import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let testHome = ''

beforeEach(() => {
  testHome = join(tmpdir(), `freeclaude-task-manager-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  process.env.FREECLAUDE_HOME = testHome
})

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true })
  delete process.env.FREECLAUDE_HOME
})

describe('taskManager', () => {
  test('rejects unknown template ids', () => {
    expect(() =>
      createTask('review the repo', {
        template: 'bogus-template' as TaskTemplateId,
      }),
    ).toThrow(/Unknown template "bogus-template"/)
  })

  test('prunes old task events to the max history window', () => {
    const task = createTask('collect task events')

    for (let index = 0; index < 505; index += 1) {
      appendTaskEvent(task.id, 'diagnostic', { index })
    }

    const events = readTaskEvents(task.id)
    expect(events).toHaveLength(500)
    expect((events[0]?.data as { index?: number } | undefined)?.index).toBe(5)
    expect(
      (events[events.length - 1]?.data as { index?: number } | undefined)?.index,
    ).toBe(504)
  })

  test('cleans stale atomic temp files during directory setup', () => {
    const tasksPath = join(testHome, 'tasks')
    mkdirSync(tasksPath, { recursive: true })
    const staleTempPath = join(tasksPath, 'orphaned-write.tmp')
    writeFileSync(staleTempPath, 'stale')
    const staleDate = new Date(Date.now() - 120_000)
    utimesSync(staleTempPath, staleDate, staleDate)

    const freshTempPath = join(tasksPath, 'fresh-write.tmp')
    writeFileSync(freshTempPath, 'fresh')
    const freshDate = new Date()
    utimesSync(freshTempPath, freshDate, freshDate)

    listTasks()

    expect(existsSync(staleTempPath)).toBe(false)
    expect(statSync(freshTempPath).mtimeMs).toBeGreaterThanOrEqual(
      freshDate.getTime() - 5_000,
    )
  })
})
