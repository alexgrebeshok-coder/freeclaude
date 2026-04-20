/**
 * FreeClaude v3 — /job Command Implementation
 *
 * View output of a specific background task by ID. All persistence and
 * log-tailing logic lives in services/jobs/jobStore so the three job
 * commands stay in lockstep.
 */

import type { LocalCommandCall } from '../../types/command.js'
import {
  logFileAgeSeconds,
  readAllJobs,
  tailLog,
  type JobRecord,
} from '../../services/jobs/jobStore.js'

const LIVE_TAIL_BYTES = 3000
const SNAPSHOT_TAIL_BYTES = 3000

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

  const liveTail = tailLog(job, LIVE_TAIL_BYTES)
  if (liveTail && liveTail.trim()) {
    lines.push('--- Output (tail) ---')
    lines.push(liveTail)
  } else if (job.output) {
    lines.push('--- Output ---')
    const output = job.output.length > SNAPSHOT_TAIL_BYTES
      ? '...(truncated)\n' + job.output.slice(-SNAPSHOT_TAIL_BYTES)
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
