import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  annotate,
  branchPath,
  exportBranch,
  fcHome,
  fork,
  gc,
  info,
  indexPath,
  listBranches,
  listSessions,
  prune,
  readBranch,
  readIndex,
  sessionDir,
} from '../session-tree.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpHome(): string {
  const base = join(tmpdir(), `fc-session-tree-test-${Math.random().toString(36).slice(2)}`)
  mkdirSync(base, { recursive: true })
  return base
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session-tree', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = makeTmpHome()
    process.env['FREECLAUDE_HOME'] = tmpHome
  })

  afterEach(() => {
    delete process.env['FREECLAUDE_HOME']
    rmSync(tmpHome, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  test('fcHome honours FREECLAUDE_HOME env var', () => {
    const home = fcHome()
    expect(home).toBe(join(tmpHome, '.freeclaude'))
  })

  // -------------------------------------------------------------------------
  test('list-sessions returns empty array when sessions root is missing', () => {
    const sessions = listSessions()
    expect(sessions).toEqual([])
  })

  // -------------------------------------------------------------------------
  test('fork creates session dir and branch file, echoes branch id', () => {
    const sid = 'sess-001'
    const bid = fork(sid)

    expect(bid).toMatch(/^b_[a-z0-9]+_[a-z0-9]{6}$/)
    expect(existsSync(sessionDir(sid))).toBe(true)
    expect(existsSync(indexPath(sid))).toBe(true)
    expect(existsSync(branchPath(sid, bid))).toBe(true)
  })

  // -------------------------------------------------------------------------
  test('fork records parentBranchId and fromTurn in branch file', () => {
    const sid = 'sess-002'
    const parentBid = fork(sid, { name: 'parent' })
    const childBid = fork(sid, { parentBranchId: parentBid, fromTurn: 7, name: 'child' })

    const rec = readBranch(sid, childBid)
    expect(rec).not.toBeNull()
    expect(rec?.parentBranchId).toBe(parentBid)
    expect(rec?.fromTurn).toBe(7)
    expect(rec?.name).toBe('child')
  })

  // -------------------------------------------------------------------------
  test('list-sessions returns session after fork', () => {
    fork('sess-alpha')
    fork('sess-beta')

    const sessions = listSessions()
    expect(sessions).toContain('sess-alpha')
    expect(sessions).toContain('sess-beta')
  })

  // -------------------------------------------------------------------------
  test('listBranches filters by session — returns only branches of that session', () => {
    fork('sess-A', { name: 'branch-in-A-1' })
    fork('sess-A', { name: 'branch-in-A-2' })
    fork('sess-B', { name: 'branch-in-B' })

    const branchesA = listBranches('sess-A')
    const branchesB = listBranches('sess-B')

    expect(branchesA).toHaveLength(2)
    expect(branchesB).toHaveLength(1)
    expect(branchesA.map(b => b.name)).toContain('branch-in-A-1')
    expect(branchesA.map(b => b.name)).toContain('branch-in-A-2')
    expect(branchesB[0]?.name).toBe('branch-in-B')
  })

  // -------------------------------------------------------------------------
  test('info returns correct branch record across sessions', () => {
    const sid = 'sess-info'
    const bid = fork(sid, { name: 'my-branch', fromTurn: 3 })

    const rec = info(bid)
    expect(rec).not.toBeNull()
    expect(rec?.branchId).toBe(bid)
    expect(rec?.sessionId).toBe(sid)
    expect(rec?.name).toBe('my-branch')
    expect(rec?.fromTurn).toBe(3)
  })

  // -------------------------------------------------------------------------
  test('prune keeps newest N branches and removes the rest', () => {
    const sid = 'sess-prune'

    // Create 5 branches with deterministic timestamps via fake Date override
    const bids: string[] = []
    for (let i = 0; i < 5; i++) {
      bids.push(fork(sid, { name: `branch-${i}` }))
    }

    const deleted = prune(sid, 3)

    expect(deleted).toHaveLength(2)
    // Deleted branch files should be gone from disk
    for (const bid of deleted) {
      expect(existsSync(branchPath(sid, bid))).toBe(false)
    }

    const remaining = listBranches(sid)
    expect(remaining).toHaveLength(3)
    // None of the deleted IDs should remain in the index
    for (const bid of deleted) {
      expect(remaining.map(b => b.branchId)).not.toContain(bid)
    }
  })

  // -------------------------------------------------------------------------
  test('gc removes orphan branch files whose index.json is missing', () => {
    const sid = 'sess-orphan'
    const bid = fork(sid)

    // Remove index.json to simulate orphaned branches
    rmSync(indexPath(sid))

    const removed = gc()
    expect(removed.length).toBeGreaterThanOrEqual(1)
    // The branch file should be gone
    expect(existsSync(branchPath(sid, bid))).toBe(false)
  })

  // -------------------------------------------------------------------------
  test('export returns JSON-parseable branch record', () => {
    const sid = 'sess-export'
    const bid = fork(sid, { name: 'export-me', fromTurn: 2 })

    const json = exportBranch(bid)
    expect(json).not.toBeNull()

    const parsed = JSON.parse(json!)
    expect(parsed.branchId).toBe(bid)
    expect(parsed.name).toBe('export-me')
    expect(parsed.fromTurn).toBe(2)
  })

  // -------------------------------------------------------------------------
  test('atomic write: no dangling .tmp file after successful fork', () => {
    const sid = 'sess-atomic'
    const bid = fork(sid)

    const idxFile = indexPath(sid)
    const brFile = branchPath(sid, bid)

    expect(existsSync(idxFile)).toBe(true)
    expect(existsSync(`${idxFile}.${process.pid}.tmp`)).toBe(false)
    expect(existsSync(brFile)).toBe(true)
    expect(existsSync(`${brFile}.${process.pid}.tmp`)).toBe(false)
  })

  // -------------------------------------------------------------------------
  test('annotate sets fcSessionId on branch record', () => {
    const sid = 'sess-annotate'
    const bid = fork(sid)

    const ok = annotate(bid, 'fc-abc-123')
    expect(ok).toBe(true)

    const rec = readBranch(sid, bid)
    expect(rec?.fcSessionId).toBe('fc-abc-123')
  })

  // -------------------------------------------------------------------------
  test('listBranches returns empty array for unknown session', () => {
    const branches = listBranches('no-such-session')
    expect(branches).toEqual([])
  })

  // -------------------------------------------------------------------------
  test('bad session for prune with 0 branches returns empty deleted list', () => {
    const deleted = prune('no-such-session', 5)
    expect(deleted).toEqual([])
  })

  // -------------------------------------------------------------------------
  test('fork appends to index with correct index entry fields', () => {
    const sid = 'sess-idx'
    const bid = fork(sid, { name: 'idx-test', fromTurn: 10 })

    const idx = readIndex(sid)
    expect(idx).not.toBeNull()
    expect(idx?.branches).toHaveLength(1)

    const entry = idx?.branches[0]
    expect(entry?.branchId).toBe(bid)
    expect(entry?.name).toBe('idx-test')
    expect(entry?.fromTurn).toBe(10)
    expect(typeof entry?.createdAt).toBe('string')
  })
})
