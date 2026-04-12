/**
 * FreeClaude v3 — /job Command Implementation
 *
 * View output of a specific background task by ID.
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
}

export const call: LocalCommandCall = async (args) => {
  const targetId = args.trim()

  if (!targetId) {
    // No ID provided — show usage
    const jobs = readAllJobs()
    const running = jobs.filter(j => j.status === 'running')

    if (running.length === 0) {
      return {
        type: 'text',
        value: 'Usage: /job <id>\n\nNo running tasks. Use /run <prompt> to start one.',
      }
    }

    // Default to latest running job
    const latest = running[0]!
    return {
      type: 'text',
      value: formatJobOutput(latest),
    }
  }

  // Find job by ID or partial ID match
  const jobs = readAllJobs()
  const matched = jobs.find(j => j.id === targetId) ||
    jobs.find(j => j.id.startsWith(targetId))

  if (!matched) {
    return {
      type: 'text',
      value: `Job "${targetId}" not found.\n\nUse /jobs to list all tasks.`,
    }
  }

  return {
    type: 'text',
    value: formatJobOutput(matched),
  }
}

function formatJobOutput(job: JobRecord): string {
  const statusIcon = job.status === 'completed' ? '✅' : job.status === 'failed' ? '❌' : '🔄'
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

  if (job.output) {
    lines.push('--- Output ---')
    // Show last 3000 chars of output
    const output = job.output.length > 3000
      ? '...(truncated)\n' + job.output.slice(-3000)
      : job.output
    lines.push(output)
  } else if (job.status === 'running') {
    lines.push('⏳ Task is still running. Use /job ' + job.id + ' again to check.')
  } else {
    lines.push('(no output captured)')
  }

  return lines.join('\n')
}
