import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  archiveTaskContext,
  forgetTaskContext,
  listVaultTasks,
  openVaultDirectoryPath,
  setTaskPinned,
} from './vaultStore.ts'

let testHome = ''

function taskPath(id: string): string {
  return join(testHome, 'tasks', `${id}.json`)
}

function seedTask(overrides: Record<string, unknown> = {}) {
  const id = String(overrides.id ?? 'task-12345678')
  const createdAt = '2025-01-01T00:00:00.000Z'
  const updatedAt = '2025-01-01T00:00:00.000Z'
  const record = {
    id,
    shortId: id.slice(0, 8),
    status: 'queued',
    cwd: '/tmp/project',
    createdAt,
    updatedAt,
    useWorktree: false,
    pinned: false,
    ...overrides,
  }
  writeFileSync(taskPath(id), JSON.stringify(record, null, 2) + '\n', 'utf-8')
  return record
}

beforeEach(() => {
  testHome = join(
    tmpdir(),
    `freeclaude-vault-store-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  process.env.FREECLAUDE_HOME = testHome
  mkdirSync(join(testHome, 'tasks'), { recursive: true })
})

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true })
  delete process.env.FREECLAUDE_HOME
})

describe('vaultStore', () => {
  test('creates vault directories on demand', () => {
    const vaultPath = openVaultDirectoryPath()

    expect(vaultPath).toBe(join(testHome, 'vault'))
    expect(existsSync(vaultPath)).toBe(true)
    expect(existsSync(join(vaultPath, 'tasks'))).toBe(true)
    expect(existsSync(join(vaultPath, 'projects'))).toBe(true)
    expect(existsSync(join(vaultPath, 'archive'))).toBe(true)
  })

  test('lists only task records with vault notes by default', () => {
    const vaultPath = openVaultDirectoryPath()
    const notePath = join(vaultPath, 'tasks', 'task-12345678.md')
    writeFileSync(notePath, '# task note\n', 'utf-8')

    seedTask({
      id: 'task-12345678',
      vaultNotePath: notePath,
      createdAt: '2025-01-01T00:00:00.000Z',
    })
    seedTask({ id: 'task-no-note', vaultNotePath: undefined })
    seedTask({
      id: 'task-archived',
      vaultNotePath: notePath,
      archivedAt: '2025-01-02T00:00:00.000Z',
      createdAt: '2025-01-03T00:00:00.000Z',
    })

    expect(listVaultTasks().map(task => task.id)).toEqual(['task-12345678'])
    expect(listVaultTasks({ includeArchived: true }).map(task => task.id)).toEqual([
      'task-archived',
      'task-12345678',
    ])
  })

  test('setTaskPinned rewrites frontmatter in the linked note', () => {
    const vaultPath = openVaultDirectoryPath()
    const notePath = join(vaultPath, 'tasks', 'task-12345678.md')
    writeFileSync(
      notePath,
      [
        '---',
        'status: queued',
        'reviewState: pending',
        'pinned: false',
        'updatedAt: 2025-01-01T00:00:00.000Z',
        '---',
        '',
        '# Task note',
      ].join('\n'),
      'utf-8',
    )

    seedTask({ id: 'task-12345678', vaultNotePath: notePath, reviewState: 'pending' })
    const task = setTaskPinned('task-12345678', true)
    const note = readFileSync(notePath, 'utf-8')

    expect(task.pinned).toBe(true)
    expect(note).toContain('pinned: true')
    expect(note).toContain(`updatedAt: ${task.updatedAt}`)
  })

  test('archiveTaskContext moves note into archive and marks task archived', () => {
    const vaultPath = openVaultDirectoryPath()
    const notePath = join(vaultPath, 'tasks', 'task-12345678.md')
    const archivedPath = join(vaultPath, 'archive', 'task-12345678.md')
    writeFileSync(notePath, '# Task note\n', 'utf-8')

    seedTask({ id: 'task-12345678', vaultNotePath: notePath })
    const task = archiveTaskContext('task-12345678')

    expect(task.archivedAt).toBeDefined()
    expect(task.vaultNotePath).toBe(archivedPath)
    expect(existsSync(notePath)).toBe(false)
    expect(existsSync(archivedPath)).toBe(true)
  })

  test('forgetTaskContext deletes note and clears vault pointers', () => {
    const vaultPath = openVaultDirectoryPath()
    const notePath = join(vaultPath, 'tasks', 'task-12345678.md')
    writeFileSync(notePath, '# Task note\n', 'utf-8')

    seedTask({
      id: 'task-12345678',
      vaultNotePath: notePath,
      archivedAt: '2025-01-02T00:00:00.000Z',
    })

    const task = forgetTaskContext('task-12345678')
    const reloaded = JSON.parse(readFileSync(taskPath('task-12345678'), 'utf-8')) as {
      vaultNotePath?: string
      archivedAt?: string
    }

    expect(existsSync(notePath)).toBe(false)
    expect(task.vaultNotePath).toBeUndefined()
    expect(task.archivedAt).toBeUndefined()
    expect(reloaded.vaultNotePath).toBeUndefined()
    expect(reloaded.archivedAt).toBeUndefined()
  })
})
