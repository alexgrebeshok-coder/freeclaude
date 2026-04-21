import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  archiveTaskContext,
  appendTaskEvent,
  createTask,
  forgetTaskContext,
  getTask,
  getRecommendedRuntimeNextStep,
  listTasks,
  listVaultTasks,
  openVaultDirectoryPath,
  readTaskEvents,
  reviewTask,
  setTaskPinned,
  type TaskTemplateId,
  updateTask,
  updateTaskLocked,
  withTaskLock,
} from './taskManager.ts'
import {
  existsSync,
  mkdirSync,
  readFileSync,
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

  test('recommends provider setup before optional voice work', () => {
    expect(
      getRecommendedRuntimeNextStep({
        providerCount: 0,
        voiceTranscriptionReady: false,
      }),
    ).toContain('Configure at least one provider')
  })

  test('treats TTS as optional and only cares about voice input readiness', () => {
    expect(
      getRecommendedRuntimeNextStep({
        providerCount: 1,
        voiceTranscriptionReady: false,
      }),
    ).toContain('local voice input dependencies')

    expect(
      getRecommendedRuntimeNextStep({
        providerCount: 1,
        voiceTranscriptionReady: true,
      }),
    ).toContain('Run a sample background task')
  })

  test('creates vault directories on demand', () => {
    const vaultPath = openVaultDirectoryPath()

    expect(vaultPath).toBe(join(testHome, 'vault'))
    expect(existsSync(vaultPath)).toBe(true)
    expect(existsSync(join(vaultPath, 'tasks'))).toBe(true)
    expect(existsSync(join(vaultPath, 'projects'))).toBe(true)
    expect(existsSync(join(vaultPath, 'archive'))).toBe(true)
  })

  test('rewrites vault note frontmatter when pinning and reviewing', () => {
    const task = createTask('capture vault context')
    const vaultPath = openVaultDirectoryPath()
    const notePath = join(vaultPath, 'tasks', `${task.id}.md`)
    writeFileSync(
      notePath,
      [
        '---',
        'status: queued',
        'reviewState: pending',
        'template: custom',
        'pinned: false',
        `createdAt: ${task.createdAt}`,
        `updatedAt: ${task.updatedAt}`,
        '---',
        '',
        '# Task note',
        '',
      ].join('\n'),
      'utf-8',
    )

    updateTask(task.id, {
      vaultNotePath: notePath,
      reviewState: 'pending',
      pinned: false,
    })

    const pinnedTask = setTaskPinned(task.id, true)
    const reviewedTask = reviewTask(task.id, 'approved')
    const note = readFileSync(notePath, 'utf-8')

    expect(pinnedTask.pinned).toBe(true)
    expect(reviewedTask.reviewState).toBe('approved')
    expect(note).toContain('pinned: true')
    expect(note).toContain('reviewState: approved')
    expect(note).toContain('status: queued')
    expect(note).toContain(`updatedAt: ${reviewedTask.updatedAt}`)
  })

  test('archives vault notes and filters archived tasks by default', () => {
    const task = createTask('archive this task context')
    const vaultPath = openVaultDirectoryPath()
    const notePath = join(vaultPath, 'tasks', `${task.id}.md`)
    writeFileSync(notePath, '# Task note\n', 'utf-8')

    updateTask(task.id, { vaultNotePath: notePath })

    expect(listVaultTasks()).toHaveLength(1)

    const archivedTask = archiveTaskContext(task.id)
    const archivedPath = join(vaultPath, 'archive', `${task.id}.md`)

    expect(archivedTask.archivedAt).toBeDefined()
    expect(archivedTask.vaultNotePath).toBe(archivedPath)
    expect(existsSync(notePath)).toBe(false)
    expect(existsSync(archivedPath)).toBe(true)
    expect(listVaultTasks()).toHaveLength(0)
    expect(listVaultTasks({ includeArchived: true })).toHaveLength(1)
  })

  test('withTaskLock serialises concurrent updateTask calls', async () => {
    const task = createTask('race on description')

    // Kick off 20 concurrent locked updates that each read the current
    // description and append a tag. Without the lock the final string
    // would drop writes because of the read-modify-write race.
    await Promise.all(
      Array.from({ length: 20 }).map((_, i) =>
        updateTaskLocked(task.id, current => ({
          ...current,
          description: `${current.description ?? ''}|${i}`,
          updatedAt: new Date().toISOString(),
        })),
      ),
    )

    const final = getTask(task.id)
    expect(final).toBeDefined()
    const appended = (final!.description ?? '').split('|').slice(1)
    expect(appended).toHaveLength(20)
    const seen = new Set(appended)
    for (let i = 0; i < 20; i++) {
      expect(seen.has(String(i))).toBe(true)
    }
  })

  test('withTaskLock releases the lock on error', async () => {
    const task = createTask('lock released on throw')

    await expect(
      withTaskLock(task.id, () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow(/boom/)

    // A subsequent lock acquisition must not hang — the previous lock
    // was released by the finally block even though fn threw.
    const result = await withTaskLock(task.id, () => 'reacquired')
    expect(result).toBe('reacquired')
  })

  test('forgets vault context by deleting the note and clearing task pointers', () => {
    const task = createTask('forget this task context')
    const vaultPath = openVaultDirectoryPath()
    const notePath = join(vaultPath, 'tasks', `${task.id}.md`)
    writeFileSync(notePath, '# Task note\n', 'utf-8')

    updateTask(task.id, { vaultNotePath: notePath })

    const forgottenTask = forgetTaskContext(task.id)
    const reloadedTask = getTask(task.id)

    expect(existsSync(notePath)).toBe(false)
    expect(forgottenTask.vaultNotePath).toBeUndefined()
    expect(reloadedTask?.vaultNotePath).toBeUndefined()
    expect(listVaultTasks()).toHaveLength(0)
  })
})
