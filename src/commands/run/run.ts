/**
 * FreeClaude v3 — /run Command Implementation
 *
 * Spawns a detached background CLI run. Output is captured via file
 * descriptors (not the parent's stdio pipes) so the child survives after
 * the REPL exits. Job persistence is delegated to services/jobs/jobStore
 * so /run, /jobs, and /job all read and write through a single surface.
 */

import type { LocalCommandCall } from '../../types/command.js'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import {
  ensureJobDirs,
  logPathFor,
  pruneOldJobs,
  saveJob,
  tailLog,
  type JobRecord,
} from '../../services/jobs/jobStore.js'

const MAX_OUTPUT_SNAPSHOT_BYTES = 10_000

// Re-export for backwards compatibility with any callers still importing
// readAllJobs from this module.
export { readAllJobs, type JobRecord } from '../../services/jobs/jobStore.js'

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

  ensureJobDirs()
  // Opportunistic housekeeping — keeps jobs/ from growing unbounded on
  // long-lived installs. Fully best-effort: any filesystem hiccup is
  // swallowed so the actual /run command never fails because of it.
  try { pruneOldJobs() } catch { /* non-critical */ }

  const jobId = randomUUID().slice(0, 8)
  const cliPath = join(import.meta.dir, '..', '..', '..', 'dist', 'cli.mjs')
  const jobLogPath = logPathFor(jobId)

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
  // a best-effort completion snapshot here; authoritative state can be
  // rebuilt later from the log file + pid liveness check.
  child.on('close', (code) => {
    const finalRecord: JobRecord = {
      ...job,
      status: code === 0 ? 'completed' : 'failed',
      exitCode: code ?? undefined,
      completedAt: new Date().toISOString(),
      output: tailLog(job, MAX_OUTPUT_SNAPSHOT_BYTES),
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
