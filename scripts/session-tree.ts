/**
 * session-tree.ts — Branch/fork management for FreeClaude sessions.
 *
 * CLI:
 *   bun run scripts/session-tree.ts list [--session SID] [--json]
 *   bun run scripts/session-tree.ts list-sessions [--json]
 *   bun run scripts/session-tree.ts fork --session SID [--from-turn N] [--name NAME]
 *   bun run scripts/session-tree.ts info --branch BID [--json]
 *   bun run scripts/session-tree.ts prune --session SID [--keep N]
 *   bun run scripts/session-tree.ts export --branch BID
 *   bun run scripts/session-tree.ts gc
 *   bun run scripts/session-tree.ts annotate --branch BID --fc-session-id FCSID
 *
 * Storage:
 *   ~/.freeclaude/sessions/<session-id>/index.json
 *   ~/.freeclaude/sessions/<session-id>/branches/<branch-id>.json
 *
 * Override base dir via FREECLAUDE_HOME env var; falls back to os.homedir().
 *
 * Exit codes: 0 = success, 1 = IO error, 2 = bad args.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single branch record stored in branches/<branch-id>.json */
export type BranchRecord = {
  branchId: string
  sessionId: string
  parentBranchId?: string
  fromTurn?: number
  name?: string
  createdAt: string
  notes?: string
  /** Resolved when the branch is first run via fc-fork.sh */
  fcSessionId?: string
}

/** Compact entry in index.json#branches */
export type BranchIndexEntry = {
  branchId: string
  name?: string
  parentBranchId?: string
  fromTurn?: number
  createdAt: string
}

/** Top-level index.json for a session */
export type SessionIndex = {
  sessionId: string
  createdAt: string
  updatedAt: string
  branches: BranchIndexEntry[]
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Returns the base FreeClaude home directory.
 * Respects `FREECLAUDE_HOME` env var; falls back to `~/.freeclaude`.
 */
export function fcHome(): string {
  return process.env['FREECLAUDE_HOME']
    ? join(process.env['FREECLAUDE_HOME'], '.freeclaude')
    : join(homedir(), '.freeclaude')
}

/** Returns the sessions root directory. */
export function sessionsRoot(): string {
  return join(fcHome(), 'sessions')
}

/** Returns the directory for a specific session. */
export function sessionDir(sessionId: string): string {
  return join(sessionsRoot(), sessionId)
}

/** Returns the path to index.json for a session. */
export function indexPath(sessionId: string): string {
  return join(sessionDir(sessionId), 'index.json')
}

/** Returns the branches directory for a session. */
export function branchesDir(sessionId: string): string {
  return join(sessionDir(sessionId), 'branches')
}

/** Returns the path to a branch JSON file. */
export function branchPath(sessionId: string, branchId: string): string {
  return join(branchesDir(sessionId), `${branchId}.json`)
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Generates a new branch ID in the format `b_<base36-timestamp>_<random6>`.
 */
export function newBranchId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `b_${ts}_${rand}`
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

/**
 * Atomically writes `data` to `filePath` by writing to a temp file first,
 * then renaming it. The temp file pattern is `<filePath>.<pid>.tmp`.
 */
export function atomicWrite(filePath: string, data: unknown): void {
  const tmp = `${filePath}.${process.pid}.tmp`
  const dir = filePath.replace(/\/[^/]+$/, '')
  if (dir) mkdirSync(dir, { recursive: true })
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  renameSync(tmp, filePath)
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

/**
 * Reads and parses index.json for a session. Returns null if missing.
 */
export function readIndex(sessionId: string): SessionIndex | null {
  const p = indexPath(sessionId)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as SessionIndex
  } catch {
    return null
  }
}

/**
 * Writes index.json atomically for a session.
 */
export function writeIndex(idx: SessionIndex): void {
  mkdirSync(sessionDir(idx.sessionId), { recursive: true })
  atomicWrite(indexPath(idx.sessionId), idx)
}

/**
 * Initialises a fresh session index (if none exists) and returns it.
 */
export function ensureIndex(sessionId: string): SessionIndex {
  const existing = readIndex(sessionId)
  if (existing) return existing
  const now = new Date().toISOString()
  return { sessionId, createdAt: now, updatedAt: now, branches: [] }
}

// ---------------------------------------------------------------------------
// Branch helpers
// ---------------------------------------------------------------------------

/**
 * Reads a branch record from disk. Returns null if not found.
 */
export function readBranch(sessionId: string, branchId: string): BranchRecord | null {
  const p = branchPath(sessionId, branchId)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as BranchRecord
  } catch {
    return null
  }
}

/**
 * Writes a branch record atomically.
 */
export function writeBranch(record: BranchRecord): void {
  mkdirSync(branchesDir(record.sessionId), { recursive: true })
  atomicWrite(branchPath(record.sessionId, record.branchId), record)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Lists all sessions (directories) under the sessions root.
 * @returns Array of session IDs.
 */
export function listSessions(): string[] {
  const root = sessionsRoot()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
}

/**
 * Lists branch index entries for a session.
 * @param sessionId - The session ID to list branches for.
 * @returns Array of BranchIndexEntry, or empty if session not found.
 */
export function listBranches(sessionId: string): BranchIndexEntry[] {
  const idx = readIndex(sessionId)
  return idx ? idx.branches : []
}

/**
 * Creates a new branch for a session.
 * Requires the session directory to already exist.
 *
 * @param sessionId - Parent session ID.
 * @param opts - Optional fork options.
 * @returns The new branch ID.
 */
export function fork(
  sessionId: string,
  opts: { fromTurn?: number; name?: string; parentBranchId?: string } = {},
): string {
  const sDir = sessionDir(sessionId)
  if (!existsSync(sDir)) {
    // Auto-create the session directory so the fork can proceed
    mkdirSync(sDir, { recursive: true })
  }

  const branchId = newBranchId()
  const now = new Date().toISOString()

  const record: BranchRecord = {
    branchId,
    sessionId,
    createdAt: now,
    ...(opts.parentBranchId !== undefined && { parentBranchId: opts.parentBranchId }),
    ...(opts.fromTurn !== undefined && { fromTurn: opts.fromTurn }),
    ...(opts.name !== undefined && { name: opts.name }),
  }

  writeBranch(record)

  const idx = ensureIndex(sessionId)
  const entry: BranchIndexEntry = {
    branchId,
    createdAt: now,
    ...(opts.name !== undefined && { name: opts.name }),
    ...(opts.parentBranchId !== undefined && { parentBranchId: opts.parentBranchId }),
    ...(opts.fromTurn !== undefined && { fromTurn: opts.fromTurn }),
  }
  idx.branches.push(entry)
  idx.updatedAt = now
  writeIndex(idx)

  return branchId
}

/**
 * Returns full info for a branch by scanning all sessions.
 * Searches all sessions if branchId does not encode the sessionId.
 *
 * @param branchId - The branch ID to look up.
 * @returns The BranchRecord, or null if not found.
 */
export function info(branchId: string): BranchRecord | null {
  for (const sid of listSessions()) {
    const rec = readBranch(sid, branchId)
    if (rec) return rec
  }
  return null
}

/**
 * Prunes branches for a session, keeping the newest N by createdAt.
 * Deletes branch files and removes entries from index.json.
 *
 * @param sessionId - Session to prune.
 * @param keep - Number of branches to keep (default 5).
 * @returns Array of deleted branch IDs.
 */
export function prune(sessionId: string, keep = 5): string[] {
  const idx = readIndex(sessionId)
  if (!idx || idx.branches.length <= keep) return []

  const sorted = [...idx.branches].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const toDelete = sorted.slice(keep)

  for (const entry of toDelete) {
    const p = branchPath(sessionId, entry.branchId)
    if (existsSync(p)) rmSync(p)
  }

  const keepSet = new Set(sorted.slice(0, keep).map(e => e.branchId))
  idx.branches = idx.branches.filter(e => keepSet.has(e.branchId))
  idx.updatedAt = new Date().toISOString()
  writeIndex(idx)

  return toDelete.map(e => e.branchId)
}

/**
 * Exports a branch record as a JSON string.
 *
 * @param branchId - The branch ID to export.
 * @returns JSON string of the BranchRecord, or null if not found.
 */
export function exportBranch(branchId: string): string | null {
  const rec = info(branchId)
  if (!rec) return null
  return JSON.stringify(rec, null, 2)
}

/**
 * Garbage-collects orphan branch files whose parent session index is missing.
 * @returns Array of removed branch file paths.
 */
export function gc(): string[] {
  const root = sessionsRoot()
  if (!existsSync(root)) return []

  const removed: string[] = []
  for (const sid of listSessions()) {
    const idxFile = indexPath(sid)
    const bDir = branchesDir(sid)
    if (!existsSync(idxFile) && existsSync(bDir)) {
      // Whole index is missing — remove all branch files
      for (const f of readdirSync(bDir)) {
        const fp = join(bDir, f)
        rmSync(fp)
        removed.push(fp)
      }
    }
  }
  return removed
}

/**
 * Annotates a branch record with a resolved fcSessionId.
 *
 * @param branchId - The branch to annotate.
 * @param fcSessionId - The FC session ID to attach.
 * @returns true on success, false if branch not found.
 */
export function annotate(branchId: string, fcSessionId: string): boolean {
  const rec = info(branchId)
  if (!rec) return false
  rec.fcSessionId = fcSessionId
  writeBranch(rec)
  return true
}

// ---------------------------------------------------------------------------
// Table formatter
// ---------------------------------------------------------------------------

function tableRow(cols: string[], widths: number[]): string {
  return cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ')
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function die(msg: string, code = 1): never {
  process.stderr.write(`session-tree: ${msg}\n`)
  process.exit(code)
}

function usage(): never {
  process.stderr.write(
    [
      'Usage:',
      '  session-tree list [--session SID] [--json]',
      '  session-tree list-sessions [--json]',
      '  session-tree fork --session SID [--from-turn N] [--name NAME]',
      '  session-tree info --branch BID [--json]',
      '  session-tree prune --session SID [--keep N]',
      '  session-tree export --branch BID',
      '  session-tree gc',
      '  session-tree annotate --branch BID --fc-session-id FCSID',
      '',
    ].join('\n'),
  )
  process.exit(2)
}

// Only run CLI when executed directly (not when imported as a module)
const isMain =
  typeof process !== 'undefined' &&
  (process.argv[1]?.endsWith('session-tree.ts') ||
    process.argv[1]?.endsWith('session-tree.js'))

if (isMain) {
  const args = process.argv.slice(2)
  const cmd = args[0]

  function flag(name: string): string | undefined {
    const i = args.indexOf(name)
    return i !== -1 ? args[i + 1] : undefined
  }
  function hasFlag(name: string): boolean {
    return args.includes(name)
  }

  switch (cmd) {
    case 'list-sessions': {
      const sessions = listSessions()
      if (hasFlag('--json')) {
        process.stdout.write(JSON.stringify(sessions) + '\n')
      } else {
        if (sessions.length === 0) {
          process.stdout.write('No sessions found.\n')
        } else {
          process.stdout.write(sessions.join('\n') + '\n')
        }
      }
      process.stdout.write(`SESSIONS_LIST=${sessions.length}\n`)
      break
    }

    case 'list': {
      const sid = flag('--session')
      if (!sid) die('--session SID required for list', 2)
      const branches = listBranches(sid)
      if (hasFlag('--json')) {
        process.stdout.write(JSON.stringify(branches, null, 2) + '\n')
      } else {
        if (branches.length === 0) {
          process.stdout.write('No branches found.\n')
        } else {
          const header = ['BRANCH_ID', 'NAME', 'FROM_TURN', 'CREATED_AT']
          const rows = branches.map(b => [
            b.branchId,
            b.name ?? '',
            b.fromTurn !== undefined ? String(b.fromTurn) : '',
            b.createdAt,
          ])
          const widths = header.map((h, i) =>
            Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)),
          )
          process.stdout.write(tableRow(header, widths) + '\n')
          process.stdout.write(widths.map(w => '-'.repeat(w)).join('  ') + '\n')
          for (const row of rows) process.stdout.write(tableRow(row, widths) + '\n')
        }
        process.stdout.write(`BRANCHES_LIST=${branches.length}\n`)
      }
      break
    }

    case 'fork': {
      const sid = flag('--session')
      if (!sid) die('--session SID required for fork', 2)
      const fromTurnRaw = flag('--from-turn')
      const fromTurn = fromTurnRaw !== undefined ? parseInt(fromTurnRaw, 10) : undefined
      const name = flag('--name')
      const parentBranchId = flag('--parent-branch')
      const bid = fork(sid, { fromTurn, name, parentBranchId })
      process.stdout.write(`BRANCH_ID=${bid}\n`)
      break
    }

    case 'info': {
      const bid = flag('--branch')
      if (!bid) die('--branch BID required for info', 2)
      const rec = info(bid)
      if (!rec) die(`Branch not found: ${bid}`, 1)
      if (hasFlag('--json')) {
        process.stdout.write(JSON.stringify(rec, null, 2) + '\n')
      } else {
        process.stdout.write(`Branch:     ${rec.branchId}\n`)
        process.stdout.write(`Session:    ${rec.sessionId}\n`)
        if (rec.name) process.stdout.write(`Name:       ${rec.name}\n`)
        if (rec.parentBranchId) process.stdout.write(`Parent:     ${rec.parentBranchId}\n`)
        if (rec.fromTurn !== undefined) process.stdout.write(`From turn:  ${rec.fromTurn}\n`)
        if (rec.fcSessionId) process.stdout.write(`FC session: ${rec.fcSessionId}\n`)
        process.stdout.write(`Created:    ${rec.createdAt}\n`)
        if (rec.notes) process.stdout.write(`Notes:      ${rec.notes}\n`)
      }
      break
    }

    case 'prune': {
      const sid = flag('--session')
      if (!sid) die('--session SID required for prune', 2)
      const keepRaw = flag('--keep')
      const keep = keepRaw !== undefined ? parseInt(keepRaw, 10) : 5
      const deleted = prune(sid, keep)
      if (deleted.length === 0) {
        process.stdout.write('Nothing to prune.\n')
      } else {
        process.stdout.write(`Pruned ${deleted.length} branch(es):\n`)
        for (const bid of deleted) process.stdout.write(`  ${bid}\n`)
      }
      break
    }

    case 'export': {
      const bid = flag('--branch')
      if (!bid) die('--branch BID required for export', 2)
      const json = exportBranch(bid)
      if (!json) die(`Branch not found: ${bid}`, 1)
      process.stdout.write(json + '\n')
      break
    }

    case 'gc': {
      const removed = gc()
      if (removed.length === 0) {
        process.stdout.write('Nothing to collect.\n')
      } else {
        process.stdout.write(`Removed ${removed.length} orphan file(s):\n`)
        for (const f of removed) process.stdout.write(`  ${f}\n`)
      }
      break
    }

    case 'annotate': {
      const bid = flag('--branch')
      if (!bid) die('--branch BID required for annotate', 2)
      const fcSid = flag('--fc-session-id')
      if (!fcSid) die('--fc-session-id FCSID required for annotate', 2)
      const ok = annotate(bid, fcSid)
      if (!ok) die(`Branch not found: ${bid}`, 1)
      process.stdout.write(`Annotated ${bid} with fcSessionId=${fcSid}\n`)
      break
    }

    default:
      usage()
  }
}
