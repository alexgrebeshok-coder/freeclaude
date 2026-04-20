/**
 * FreeClaude v3 — /run Command Implementation
 *
 * Spawns a detached background CLI run. Output is captured via file
 * descriptors (not the parent's stdio pipes) so the child survives after
 * the REPL exits. Job status is persisted as a per-job JSON file so
 * listing never shows duplicate records even after repeated append/update
 * cycles. The index.jsonl file is kept as an append-only audit log.
 */

import type { LocalCommandCall } from '../../types/command.js'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'

const JOBS_DIR = join(homedir(), '.freeclaude', 'jobs')
const RECORDS_DIR = join(JOBS_DIR, 'records')
const LOGS_DIR = join(JOBS_DIR, 'logs')
const INDEX_PATH = join(JOBS_DIR, 'index.jsonl')
const MAX_OUTPUT_SNAPSHOT_BYTES = 10_000

export type JobRecord = {
  id: string
  prompt: string
  status: 'running' | 'completed' | 'failed'
  createdAt: string
  completedAt?: string
  exitCode?: number
  pid?: number
  output?: string
  logPath?: string
}

function ensureDirs(): void {
  for (const dir of [JOBS_DIR, RECORDS_DIR, LOGS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

function recordPath(id: string): string {
  return join(RECORDS_DIR, `${id}.json`)
}

function logPath(id: string): string {
  return join(LOGS_DIR, `${id}.log`)
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8')
  renameSync(tmp, path)
}

function appendIndex(job: JobRecord): void {
  ensureDirs()
  appendFileSync(INDEX_PATH, JSON.stringify(job) + '\n', 'utf-8')
}

function saveJob(job: JobRecord): void {
  ensureDirs()
  writeJsonAtomic(recordPath(job.id), job)
  appendIndex(job)
}

function loadJobRecord(id: string): JobRecord | null {
  try {
    return JSON.parse(readFileSync(recordPath(id), 'utf-8')) as JobRecord
  } catch {
    return null
  }
}

function tailLog(path: string, maxBytes: number): string {
  try {
    const data = readFileSync(path, 'utf-8')
    return data.length > maxBytes ? data.slice(-maxBytes) : data
  } catch {
    return ''
  }
}

// Backwards-compatible reader: prefer per-job record files (new format),
// fall back to the legacy index.jsonl entries (latest wins per id).
export function readAllJobs(): JobRecord[] {
  ensureDirs()

  const byId = new Map<string, JobRecord>()

  if (existsSync(INDEX_PATH)) {
    for (const line of readFileSync(INDEX_PATH, 'utf-8').split('\n')) {
      if (!line) continue
      try {
        const record = JSON.parse(line) as JobRecord
        if (record?.id) byId.set(record.id, record)
      } catch {
        /* ignore malformed lines */
      }
    }
  }

  if (existsSync(RECORDS_DIR)) {
    for (const name of readdirSync(RECORDS_DIR)) {
      if (!name.endsWith('.json')) continue
      const record = loadJobRecord(name.slice(0, -'.json'.length))
      if (record?.id) byId.set(record.id, record)
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()
  if (!trimmed) {
    return {
      type: 'text',
      value: [
        'Usage: /run <prompt>',
        '',
        'Examples:',
        '  /run refactor auth module',
        '  /run fix all TypeScript errors',
        '  /run add unit tests for utils.ts',
        '',
        'Use /jobs to list background tasks.',
        'Use /job <id> to view task output.',
      ].join('\n'),
    }
  }

  ensureDirs()

  const jobId = randomUUID().slice(0, 8)
  const cliPath = join(import.meta.dir, '..', '..', '..', 'dist', 'cli.mjs')
  const jobLogPath = logPath(jobId)

  // Open a dedicated log file so the detached child writes directly to
  // disk. This keeps output flowing even after the REPL exits — the
  // parent's pipe handlers previously died with the parent process.
  const logFd = openSync(jobLogPath, 'a')

  const job: JobRecord = {
    id: jobId,
    prompt: trimmed,
    status: 'running',
    createdAt: new Date().toISOString(),
    logPath: jobLogPath,
  }
  saveJob(job)

  const child = spawn(
    process.execPath,
    [cliPath, '--print', trimmed],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        CLAUDE_CODE_USE_OPENAI: '1',
      },
    },
  )

  // The child owns the log fd after spawn — close our copy so the file
  // is released cleanly when the child exits.
  try { closeSync(logFd) } catch { /* ignore */ }

  job.pid = child.pid
  saveJob(job)

  // `on('close')` only fires while the parent process is alive. Record
  // a best-effort completion snapshot here, but the authoritative status
  // can always be rebuilt by `/jobs` by inspecting the pid liveness.
  child.on('close', (code) => {
    const finalRecord: JobRecord = {
      ...job,
      status: code === 0 ? 'completed' : 'failed',
      exitCode: code ?? undefined,
      completedAt: new Date().toISOString(),
      output: tailLog(jobLogPath, MAX_OUTPUT_SNAPSHOT_BYTES),
    }
    try { saveJob(finalRecord) } catch { /* non-critical */ }
  })

  child.on('error', (err) => {
    const finalRecord: JobRecord = {
      ...job,
      status: 'failed',
      completedAt: new Date().toISOString(),
      output: err.message,
    }
    try { saveJob(finalRecord) } catch { /* non-critical */ }
  })

  child.unref() // allow parent REPL to exit independently

  return {
    type: 'text',
    value: [
      `🚀 Background task started`,
      `   ID: ${jobId}`,
      `   PID: ${child.pid}`,
      `   Prompt: ${trimmed}`,
      '',
      `   Use /jobs to list all tasks`,
      `   Use /job ${jobId} to view output`,
      '',
      `   Output: ${jobLogPath}`,
    ].join('\n'),
  }
}
