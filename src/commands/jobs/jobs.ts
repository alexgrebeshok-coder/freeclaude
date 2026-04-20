/**
 * FreeClaude v3 — /jobs Command Implementation
 *
 * Lists all background tasks. Records live in two places:
 *   ~/.freeclaude/jobs/records/<id>.json   — authoritative per-job state
 *   ~/.freeclaude/jobs/index.jsonl         — append-only audit log
 *
 * Legacy installs that only have index.jsonl are still supported:
 * entries are deduplicated by id (latest wins) and any job still marked
 * as "running" whose pid is no longer alive is reported as "stale".
 */

import type { LocalCommandCall } from '../../types/command.js'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const JOBS_DIR = join(homedir(), '.freeclaude', 'jobs')
const RECORDS_DIR = join(JOBS_DIR, 'records')
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

  // Reconcile stale "running" entries: pid no longer alive means the
  // worker crashed before writing a terminal state (common when the REPL
  // exited mid-task in older builds).
  for (const job of jobs) {
    if (job.status === 'running' && !isProcessAlive(job.pid)) {
      job.status = 'stale'
    }
  }

  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function formatDuration(start: string, end?: string): string {
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()
  if (ms < 0) return '0ms'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function statusIcon(status: string): string {
  switch (status) {
    case 'running': return '🔄'
    case 'completed': return '✅'
    case 'failed': return '❌'
    case 'stale': return '⚠️'
    default: return '❓'
  }
}

export const call: LocalCommandCall = async () => {
  const jobs = readAllJobs()

  if (jobs.length === 0) {
    return {
      type: 'text',
      value: 'No background tasks yet. Use /run <prompt> to start one.',
    }
  }

  const running = jobs.filter(j => j.status === 'running').length
  const completed = jobs.filter(j => j.status === 'completed').length
  const failed = jobs.filter(j => j.status === 'failed').length
  const stale = jobs.filter(j => j.status === 'stale').length

  const summary = [
    `🔄 ${running} running`,
    `✅ ${completed} completed`,
    `❌ ${failed} failed`,
    ...(stale > 0 ? [`⚠️ ${stale} stale`] : []),
  ].join(' · ')

  const header = [
    `📋 Background Tasks (${jobs.length})`,
    `   ${summary}`,
    '',
  ].join('\n')

  const rows = jobs.slice(0, 20).map(job => {
    const icon = statusIcon(job.status)
    const duration = formatDuration(job.createdAt, job.completedAt)
    const time = new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const exitInfo = job.exitCode !== undefined ? ` (exit ${job.exitCode})` : ''
    const prompt = job.prompt.length > 60 ? job.prompt.slice(0, 57) + '...' : job.prompt

    return `  ${icon} ${job.id}  ${time}  ${duration}${exitInfo}  ${prompt}`
  })

  const footer = jobs.length > 20
    ? `\n   ... and ${jobs.length - 20} more (showing latest 20)`
    : ''

  return {
    type: 'text',
    value: header + rows.join('\n') + footer + '\n\n  Use /job <id> to view output',
  }
}
