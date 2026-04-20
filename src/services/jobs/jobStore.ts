/**
 * FreeClaude v3 — Background Job Store
 *
 * Single source of truth for /run, /jobs, and /job. Keeps job state in
 * two places on disk:
 *
 *   ~/.freeclaude/jobs/records/<id>.json  — authoritative per-job state
 *   ~/.freeclaude/jobs/logs/<id>.log      — detached child stdout/stderr
 *   ~/.freeclaude/jobs/index.jsonl        — append-only audit log
 *
 * Records/ takes precedence over index.jsonl when both describe the
 * same id. A job marked "running" whose pid is no longer alive is
 * reported as "stale" so callers can surface crashed workers.
 *
 * Housekeeping:
 *   pruneOldJobs(opts)        — TTL + max-count pruning of finished jobs
 *
 * This module is ESM-safe and deliberately has no runtime side effects
 * on import — directories are created lazily by the first write.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const ENV_JOBS_DIR = 'FREECLAUDE_JOBS_DIR'

function baseDir(): string {
  const override = process.env[ENV_JOBS_DIR]
  if (override && override.length > 0) return override
  return join(homedir(), '.freeclaude', 'jobs')
}

/**
 * Resolve the live jobs directory. The test suite (and any caller that
 * wants a throwaway location) can point it elsewhere via the
 * FREECLAUDE_JOBS_DIR env var — this is evaluated lazily so tests can
 * set the variable after the module is imported.
 */
export function getJobsDir(): string {
  return baseDir()
}
export function getRecordsDir(): string {
  return join(baseDir(), 'records')
}
export function getLogsDir(): string {
  return join(baseDir(), 'logs')
}
export function getIndexPath(): string {
  return join(baseDir(), 'index.jsonl')
}

/** @deprecated Use getJobsDir() — kept for backwards compatibility. */
export const JOBS_DIR = baseDir()
/** @deprecated Use getRecordsDir(). */
export const RECORDS_DIR = join(JOBS_DIR, 'records')
/** @deprecated Use getLogsDir(). */
export const LOGS_DIR = join(JOBS_DIR, 'logs')
/** @deprecated Use getIndexPath(). */
export const INDEX_PATH = join(JOBS_DIR, 'index.jsonl')

export type JobStatus = 'running' | 'completed' | 'failed' | 'stale'

export interface JobRecord {
  id: string
  prompt: string
  status: JobStatus
  createdAt: string
  completedAt?: string
  exitCode?: number
  pid?: number
  output?: string
  logPath?: string
}

export function ensureJobDirs(): void {
  for (const dir of [getJobsDir(), getRecordsDir(), getLogsDir()]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

export function recordPath(id: string): string {
  return join(getRecordsDir(), `${id}.json`)
}

export function logPathFor(id: string): string {
  return join(getLogsDir(), `${id}.log`)
}

/**
 * POSIX-style liveness check. `kill(pid, 0)` sends no signal and simply
 * probes whether the process exists and we have permission to signal it.
 * Reject non-positive pids explicitly because `kill(0, 0)` would
 * otherwise report success on the current process group.
 */
export function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  ensureJobDirs()
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8')
  renameSync(tmp, path)
}

function appendIndex(job: JobRecord): void {
  ensureJobDirs()
  appendFileSync(getIndexPath(), JSON.stringify(job) + '\n', 'utf-8')
}

export function saveJob(job: JobRecord): void {
  writeJsonAtomic(recordPath(job.id), job)
  appendIndex(job)
}

export function loadJobRecord(id: string): JobRecord | null {
  try {
    const raw = readFileSync(recordPath(id), 'utf-8')
    const parsed = JSON.parse(raw) as JobRecord
    return parsed?.id ? parsed : null
  } catch {
    return null
  }
}

/**
 * Read all jobs from records/ (preferred) and fall back to the legacy
 * index.jsonl. Entries are deduplicated by id — records/ wins because it
 * is always rewritten atomically with the latest known status. After
 * reconciliation, any still-"running" job whose pid has died is flipped
 * to "stale" so callers get a consistent view.
 */
export function readAllJobs(): JobRecord[] {
  ensureJobDirs()
  const byId = new Map<string, JobRecord>()

  const indexPath = getIndexPath()
  if (existsSync(indexPath)) {
    for (const line of readFileSync(indexPath, 'utf-8').split('\n')) {
      if (!line) continue
      try {
        const record = JSON.parse(line) as JobRecord
        if (record?.id) byId.set(record.id, record)
      } catch {
        /* ignore malformed lines — index.jsonl is best-effort */
      }
    }
  }

  const recordsDir = getRecordsDir()
  if (existsSync(recordsDir)) {
    for (const name of readdirSync(recordsDir)) {
      if (!name.endsWith('.json')) continue
      const record = loadJobRecord(name.slice(0, -'.json'.length))
      if (record?.id) byId.set(record.id, record)
    }
  }

  const jobs = Array.from(byId.values())
  for (const job of jobs) {
    if (job.status === 'running' && !isProcessAlive(job.pid)) {
      job.status = 'stale'
    }
  }

  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Read the tail of the log file associated with a job. Returns an
 * empty string if the file is missing or unreadable.
 */
export function tailLog(job: JobRecord, maxBytes: number): string {
  const candidate = job.logPath ?? logPathFor(job.id)
  if (!existsSync(candidate)) return ''
  try {
    const data = readFileSync(candidate, 'utf-8')
    if (data.length <= maxBytes) return data
    return '...(truncated)\n' + data.slice(-maxBytes)
  } catch {
    return ''
  }
}

export function logFileAgeSeconds(job: JobRecord): number | null {
  const candidate = job.logPath ?? logPathFor(job.id)
  if (!existsSync(candidate)) return null
  try {
    const stats = statSync(candidate)
    return Math.max(0, Math.floor((Date.now() - stats.mtimeMs) / 1000))
  } catch {
    return null
  }
}

export interface PruneOptions {
  /** Discard finished (completed/failed/stale) jobs older than this. */
  maxAgeMs?: number
  /** Hard cap on finished jobs kept on disk (oldest removed first). */
  maxFinishedCount?: number
  /** Delete orphaned log files for jobs that no longer have a record. */
  deleteOrphanLogs?: boolean
}

export interface PruneResult {
  removedRecords: number
  removedLogs: number
  rewroteIndex: boolean
}

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const DEFAULT_MAX_FINISHED = 500

/**
 * Best-effort job housekeeping. Running jobs are never pruned. The
 * index.jsonl file is rewritten without the removed entries so it
 * can't grow unbounded over long-lived installs.
 */
export function pruneOldJobs(options: PruneOptions = {}): PruneResult {
  ensureJobDirs()
  const {
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    maxFinishedCount = DEFAULT_MAX_FINISHED,
    deleteOrphanLogs = true,
  } = options

  const jobs = readAllJobs()
  const now = Date.now()
  const toRemove = new Set<string>()

  const finished = jobs.filter(j => j.status !== 'running')
  for (const job of finished) {
    const reference = job.completedAt ?? job.createdAt
    const age = now - new Date(reference).getTime()
    if (age > maxAgeMs) toRemove.add(job.id)
  }

  // Enforce hard cap on finished jobs — oldest first.
  const keepable = finished
    .filter(j => !toRemove.has(j.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (keepable.length > maxFinishedCount) {
    for (const job of keepable.slice(maxFinishedCount)) {
      toRemove.add(job.id)
    }
  }

  let removedRecords = 0
  let removedLogs = 0

  for (const id of toRemove) {
    try {
      rmSync(recordPath(id), { force: true })
      removedRecords++
    } catch {
      /* best effort */
    }
    try {
      rmSync(logPathFor(id), { force: true })
      removedLogs++
    } catch {
      /* best effort */
    }
  }

  let rewroteIndex = false
  const indexPath = getIndexPath()
  if (existsSync(indexPath) && toRemove.size > 0) {
    const lines = readFileSync(indexPath, 'utf-8').split('\n').filter(Boolean)
    const kept: string[] = []
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as JobRecord
        if (record?.id && !toRemove.has(record.id)) kept.push(line)
      } catch {
        kept.push(line)
      }
    }
    const tmp = `${indexPath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '', 'utf-8')
    renameSync(tmp, indexPath)
    rewroteIndex = true
  }

  const logsDir = getLogsDir()
  if (deleteOrphanLogs && existsSync(logsDir)) {
    const knownIds = new Set(readAllJobs().map(j => j.id))
    for (const name of readdirSync(logsDir)) {
      if (!name.endsWith('.log')) continue
      const id = name.slice(0, -'.log'.length)
      if (knownIds.has(id)) continue
      try {
        rmSync(join(logsDir, name), { force: true })
        removedLogs++
      } catch {
        /* best effort */
      }
    }
  }

  return { removedRecords, removedLogs, rewroteIndex }
}
