/**
 * FreeClaude v3 — /jobs Command Implementation
 *
 * Lists all background tasks from ~/.freeclaude/jobs/index.jsonl
 */

import type { LocalCommandCall } from '../../types/command.js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const JOBS_DIR = join(homedir(), '.freeclaude', 'jobs')

type JobRecord = {
  id: string
  prompt: string
  status: 'running' | 'completed' | 'failed'
  createdAt: string
  completedAt?: string
  exitCode?: number
  pid?: number
  output?: string
}

function readAllJobs(): JobRecord[] {
  const indexPath = join(JOBS_DIR, 'index.jsonl')
  if (!existsSync(indexPath)) return []
  return readFileSync(indexPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) as JobRecord } catch { return null }
    })
    .filter((j): j is JobRecord => j !== null)
    .reverse()
}

function formatDuration(start: string, end?: string): string {
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function statusIcon(status: string): string {
  switch (status) {
    case 'running': return '🔄'
    case 'completed': return '✅'
    case 'failed': return '❌'
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

  const header = [
    `📋 Background Tasks (${jobs.length})`,
    `   🔄 ${running} running · ✅ ${completed} completed · ❌ ${failed} failed`,
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
