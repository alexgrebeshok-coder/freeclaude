/**
 * FreeClaude v3 — /jobs Command Implementation
 *
 * Thin presentation layer on top of services/jobs/jobStore. The store
 * handles persistence, dedup, and the stale-worker reconciliation that
 * this command used to do inline.
 */

import type { LocalCommandCall } from '../../types/command.js'
import { pruneOldJobs, readAllJobs } from '../../services/jobs/jobStore.js'

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
  // Opportunistic housekeeping — keeps the list view responsive on
  // installs that have accumulated thousands of completed jobs. Any
  // filesystem failure is swallowed so /jobs never fails because of it.
  try { pruneOldJobs() } catch { /* non-critical */ }

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
