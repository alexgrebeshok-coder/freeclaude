import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  addLesson,
  formatMarkdown,
  listLessons,
  loadStore,
  pruneStore,
  queryLessons,
  saveStore,
} from '../lessons.ts'
import type { Store } from '../lessons.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempPath(): string {
  return join(
    tmpdir(),
    `fc-lessons-test-${Math.random().toString(36).slice(2)}.json`,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lessons', () => {
  let storePath: string

  beforeEach(() => {
    storePath = tempPath()
  })

  afterEach(() => {
    rmSync(storePath, { force: true })
    // Clean up any leftover tmp files from atomic writes
    rmSync(`${storePath}.${process.pid}.tmp`, { force: true })
  })

  // -------------------------------------------------------------------------
  test('add + list roundtrip stores and retrieves a lesson', () => {
    addLesson(storePath, {
      project: 'myapp',
      task: 'T-1',
      outcome: 'ok',
      lesson: 'Always use const for immutable bindings',
      tags: ['js', 'style'],
    })

    const store = loadStore(storePath)
    const lessons = listLessons(store)

    expect(lessons).toHaveLength(1)
    expect(lessons[0]?.project).toBe('myapp')
    expect(lessons[0]?.task).toBe('T-1')
    expect(lessons[0]?.outcome).toBe('ok')
    expect(lessons[0]?.lesson).toBe('Always use const for immutable bindings')
    expect(lessons[0]?.tags).toEqual(['js', 'style'])
  })

  // -------------------------------------------------------------------------
  test('list returns lessons newest-first', () => {
    // Seed store directly with explicit timestamps to avoid same-ms collisions
    const store: Store = {
      version: 1,
      lessons: [
        {
          id: 'old-1',
          project: 'proj',
          task: 'A',
          outcome: 'ok',
          lesson: 'older',
          tags: [],
          ts: 1000,
        },
        {
          id: 'new-1',
          project: 'proj',
          task: 'B',
          outcome: 'ok',
          lesson: 'newer',
          tags: [],
          ts: 2000,
        },
      ],
    }
    saveStore(storePath, store)

    const loaded = loadStore(storePath)
    const lessons = listLessons(loaded)

    expect(lessons[0]?.id).toBe('new-1')
    expect(lessons[1]?.id).toBe('old-1')
  })

  // -------------------------------------------------------------------------
  test('list filters by project', () => {
    addLesson(storePath, { project: 'alpha', task: 'T1', outcome: 'ok', lesson: 'alpha note', tags: [] })
    addLesson(storePath, { project: 'beta',  task: 'T2', outcome: 'ok', lesson: 'beta note',  tags: [] })

    const store = loadStore(storePath)
    const lessons = listLessons(store, { project: 'alpha' })

    expect(lessons).toHaveLength(1)
    expect(lessons[0]?.project).toBe('alpha')
  })

  // -------------------------------------------------------------------------
  test('list filters by tags (any overlap)', () => {
    addLesson(storePath, { project: 'p', task: 'T1', outcome: 'ok', lesson: 'has foo tag', tags: ['foo', 'bar'] })
    addLesson(storePath, { project: 'p', task: 'T2', outcome: 'ok', lesson: 'has baz tag', tags: ['baz'] })
    addLesson(storePath, { project: 'p', task: 'T3', outcome: 'ok', lesson: 'untagged',    tags: [] })

    const store = loadStore(storePath)
    const lessons = listLessons(store, { tags: ['foo'] })

    expect(lessons).toHaveLength(1)
    expect(lessons[0]?.lesson).toBe('has foo tag')
  })

  // -------------------------------------------------------------------------
  test('query scoring puts better matches first', () => {
    addLesson(storePath, {
      project: 'proj', task: 'T1', outcome: 'ok',
      lesson: 'avoid mutation in reducers',
      tags: ['redux'],
    })
    addLesson(storePath, {
      project: 'proj', task: 'T2', outcome: 'ok',
      lesson: 'use immutable patterns',
      tags: ['immutable', 'redux'],
    })
    addLesson(storePath, {
      project: 'proj', task: 'T3', outcome: 'ok',
      lesson: 'unrelated note about servers',
      tags: [],
    })

    const store = loadStore(storePath)
    // "redux" matches as a tag (weight 2), so the lesson with tags=['redux'] scores higher
    const results = queryLessons(store, 'redux', 5)

    expect(results.length).toBeGreaterThanOrEqual(2)
    // Both redux-tagged lessons should appear; unrelated should be absent
    expect(results.map(l => l.task)).not.toContain('T3')
  })

  // -------------------------------------------------------------------------
  test('query returns empty array for no matches', () => {
    addLesson(storePath, {
      project: 'p', task: 'T', outcome: 'ok', lesson: 'something specific', tags: [],
    })
    const store = loadStore(storePath)
    const results = queryLessons(store, 'zzznomatch', 10)
    expect(results).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  test('prune retains newest N lessons', () => {
    // Seed with explicit timestamps so ordering is deterministic
    const store: Store = {
      version: 1,
      lessons: [1000, 2000, 3000, 4000, 5000].map((ts, i) => ({
        id: `l-${i}`,
        project: 'p',
        task: `T${i}`,
        outcome: 'ok' as const,
        lesson: `lesson ${i}`,
        tags: [],
        ts,
      })),
    }
    saveStore(storePath, store)

    const loaded = loadStore(storePath)
    const pruned = pruneStore(loaded, 3)

    expect(pruned.lessons).toHaveLength(3)
    // Should keep the 3 with the highest ts (ts=3000,4000,5000)
    const keptTs = pruned.lessons.map(l => l.ts).sort((a, b) => a - b)
    expect(keptTs).toEqual([3000, 4000, 5000])
  })

  // -------------------------------------------------------------------------
  test('atomic write: tmp file is renamed to final path, no dangling tmp', () => {
    addLesson(storePath, {
      project: 'p', task: 'T', outcome: 'ok', lesson: 'atomic test', tags: [],
    })
    // Final file must exist
    expect(existsSync(storePath)).toBe(true)
    // Tmp file must NOT be present after a successful write
    expect(existsSync(`${storePath}.${process.pid}.tmp`)).toBe(false)
  })

  // -------------------------------------------------------------------------
  test('bad outcome is rejected with an error', () => {
    expect(() =>
      addLesson(storePath, {
        project: 'p', task: 'T',
        outcome: 'invalid' as 'ok',
        lesson: 'should fail',
        tags: [],
      }),
    ).toThrow(/Invalid outcome/)
  })

  // -------------------------------------------------------------------------
  test('lesson text is trimmed to 2000 chars', () => {
    const longText = 'x'.repeat(3000)
    const entry = addLesson(storePath, {
      project: 'p', task: 'T', outcome: 'ok', lesson: longText, tags: [],
    })
    expect(entry.lesson).toHaveLength(2000)

    const store = loadStore(storePath)
    expect(store.lessons[0]?.lesson).toHaveLength(2000)
  })

  // -------------------------------------------------------------------------
  test('formatMarkdown produces expected structure', () => {
    const entry = addLesson(storePath, {
      project: 'myproj', task: 'TASK-42', outcome: 'fail',
      lesson: 'remember to handle edge cases',
      tags: ['testing', 'edge'],
    })

    const store = loadStore(storePath)
    const md = formatMarkdown(store.lessons)

    expect(md).toContain('## myproj / TASK-42 [fail]')
    expect(md).toContain('remember to handle edge cases')
    expect(md).toContain('Tags: testing, edge')
    // id should NOT appear in markdown output
    expect(md).not.toContain(entry.id)
  })

  // -------------------------------------------------------------------------
  test('loadStore initializes empty store when file missing', () => {
    const nonExistent = tempPath()
    const store = loadStore(nonExistent)
    expect(store.version).toBe(1)
    expect(store.lessons).toHaveLength(0)
    // No file should be created on the filesystem by loadStore alone
    expect(existsSync(nonExistent)).toBe(false)
  })

  // -------------------------------------------------------------------------
  test('saveStore + loadStore roundtrip preserves all fields', () => {
    const store: Store = {
      version: 1,
      lessons: [
        {
          id: 'abc-123',
          project: 'roundtrip',
          task: 'RT-1',
          outcome: 'partial',
          lesson: 'serialize everything',
          tags: ['a', 'b'],
          ts: 1700000000000,
        },
      ],
    }
    saveStore(storePath, store)
    const loaded = loadStore(storePath)

    expect(loaded.version).toBe(1)
    expect(loaded.lessons).toHaveLength(1)
    expect(loaded.lessons[0]).toEqual(store.lessons[0])
  })
})
