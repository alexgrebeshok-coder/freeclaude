/**
 * FreeClaude v3 — /job Command Implementation
 *
 * View output of a specific background task by ID. Reads from the new
 * per-job record files, falls back to the append-only index.jsonl for
 * legacy installs, and streams the latest bytes from the detached log
 * file when the task is still running.
 */

import type { LocalCommandCall } from '../../types/command.js'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const JOBS_DIR = join(homedir(), '.freeclaude', 'jobs')
const RECORDS_DIR = join(JOBS_DIR, 'records')
const LOGS_DIR = join(JOBS_DIR, 'logs')
const INDEX_PATH = join(JOBS_DIR, 'index.jsonl')

type JobStatus = 'running' | 'completed' | 'failed' | 'stale'

type JobRecord = {
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

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readAllJobs(): JobRecord[] {
  const byId = new Map<string, JobRecord>()

  if (existsSync(INDEX_PATH)) {
    for (const line of readFileSync(INDEX_PATH, 'utf-8').split('\n')) {
      if (!line) continue
      try {
        const record = JSON.parse(line) as JobRecord
        if (record?.id) byId.set(record.id, record)
      } catch {
        /* skip malformed */
      }
    }
  }

  if (existsSync(RECORDS_DIR)) {
    for (const name of readdirSync(RECORDS_DIR)) {
      if (!name.endsWith('.json')) continue
      try {
        const record = JSON.parse(
          readFileSync(join(RECORDS_DIR, name), 'utf-8'),
        ) as JobRecord
        if (record?.id) byId.set(record.id, record)
      } catch {
        /* skip malformed */
      }
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

function tailLog(job: JobRecord, maxBytes: number): string | undefined {
  const candidate = job.logPath ?? join(LOGS_DIR, `${job.id}.log`)
  if (!existsSync(candidate)) return undefined
  try {
    const data = readFileSync(candidate, 'utf-8')
    return data.length > maxBytes ? '...(truncated)\n' + data.slice(-maxBytes) : data
  } catch {
    return undefined
  }
}

function logFileAgeSeconds(job: JobRecord): number | null {
  const candidate = job.logPath ?? join(LOGS_DIR, `${job.id}.log`)
  if (!existsSync(candidate)) return null
  try {
    const stats = statSync(candidate)
    return Math.max(0, Math.floor((Date.now() - stats.mtimeMs) / 1000))
  } catch {
    return null
  }
}

export const call: LocalCommandCall = async (args) => {
  const targetId = args.trim()

  if (!targetId) {
    const jobs = readAllJobs()
    const running = jobs.filter(j => j.status === 'running')
    if (running.length === 0) {
      return {
        type: 'text',
        value: 'Usage: /job <id>\n\nNo running tasks. Use /run <prompt> to start one.',
      }
    }
    return { type: 'text', value: formatJobOutput(running[0]!) }
  }

  const jobs = readAllJobs()
  const matched =
    jobs.find(j => j.id === targetId) ??
    jobs.find(j => j.id.startsWith(targetId))

  if (!matched) {
    return {
      type: 'text',
      value: `Job "${targetId}" not found.\n\nUse /jobs to list all tasks.`,
    }
  }

  return { type: 'text', value: formatJobOutput(matched) }
}

function formatJobOutput(job: JobRecord): string {
  const statusIcon =
    job.status === 'completed' ? '✅' :
    job.status === 'failed' ? '❌' :
    job.status === 'stale' ? '⚠️' : '🔄'
  const duration = job.completedAt
    ? `${((new Date(job.completedAt).getTime() - new Date(job.createdAt).getTime()) / 1000).toFixed(1)}s`
    : 'running...'

  const lines = [
    `${statusIcon} Job ${job.id}`,
    `   Status: ${job.status}${job.exitCode !== undefined ? ` (exit ${job.exitCode})` : ''}`,
    `   Duration: ${duration}`,
    `   Created: ${new Date(job.createdAt).toLocaleString()}`,
    `   Prompt: ${job.prompt}`,
    '',
  ]

  const liveTail = tailLog(job, 3000)
  if (liveTail && liveTail.trim()) {
    lines.push('--- Output (tail) ---')
    lines.push(liveTail)
  } else if (job.output) {
    lines.push('--- Output ---')
    const output = job.output.length > 3000
      ? '...(truncated)\n' + job.output.slice(-3000)
      : job.output
    lines.push(output)
  } else if (job.status === 'running') {
    const age = logFileAgeSeconds(job)
    const hint = age !== null
      ? `⏳ Task is still running (no output yet, idle for ${age}s). Run /job ${job.id} again to recheck.`
      : `⏳ Task is still running. Run /job ${job.id} again to check.`
    lines.push(hint)
  } else if (job.status === 'stale') {
    lines.push('⚠️ Worker process is no longer running and no output was captured.')
    lines.push('   Use /run to start a new task.')
  } else {
    lines.push('(no output captured)')
  }

  return lines.join('\n')
}
