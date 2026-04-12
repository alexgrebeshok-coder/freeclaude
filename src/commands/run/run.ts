/**
 * FreeClaude v3 — /run Command Implementation
 *
 * Spawns a background AI task using run_in_background mode.
 * The task runs asynchronously and its output can be retrieved with /jobs or /job <id>.
 */

import type { LocalCommandCall } from '../../types/command.js'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'

const JOBS_DIR = join(homedir(), '.freeclaude', 'jobs')

export type JobRecord = {
  id: string
  prompt: string
  status: 'running' | 'completed' | 'failed'
  createdAt: string
  completedAt?: string
  exitCode?: number
  pid?: number
  output?: string
}

function ensureJobsDir(): void {
  if (!existsSync(JOBS_DIR)) {
    mkdirSync(JOBS_DIR, { recursive: true })
  }
}

function saveJob(job: JobRecord): void {
  ensureJobsDir()
  appendFileSync(join(JOBS_DIR, 'index.jsonl'), JSON.stringify(job) + '\n')
}

function readAllJobs(): JobRecord[] {
  ensureJobsDir()
  const indexPath = join(JOBS_DIR, 'index.jsonl')
  if (!existsSync(indexPath)) return []
  return readFileSync(indexPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) as JobRecord } catch { return null }
    })
    .filter((j): j is JobRecord => j !== null)
    .reverse() // newest first
}

function getLatestJobForPrompt(prompt: string): JobRecord | undefined {
  return readAllJobs().find(j => j.prompt === prompt && j.status === 'running')
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

  const jobId = randomUUID().slice(0, 8)
  const cliPath = join(import.meta.dir, '..', '..', '..', 'dist', 'cli.mjs')

  const job: JobRecord = {
    id: jobId,
    prompt: trimmed,
    status: 'running',
    createdAt: new Date().toISOString(),
  }
  saveJob(job)

  // Spawn the CLI in background with --print mode
  const child = spawn(
    process.execPath,
    [cliPath, '--print', trimmed],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLAUDE_CODE_USE_OPENAI: '1',
      },
    },
  )

  job.pid = child.pid
  // Update record with PID
  const allJobs = readAllJobs()
  const existingIdx = allJobs.findIndex(j => j.id === jobId)
  if (existingIdx >= 0) {
    allJobs[existingIdx] = { ...allJobs[existingIdx]!, pid: child.pid }
    writeFileSync(
      join(JOBS_DIR, 'index.jsonl'),
      allJobs.reverse().map(j => JSON.stringify(j)).join('\n') + '\n',
    )
  }

  child.unref() // Allow parent to exit independently

  // Collect output asynchronously
  let output = ''
  child.stdout?.on('data', (data: Buffer) => {
    output += data.toString()
  })
  child.stderr?.on('data', (data: Buffer) => {
    output += data.toString()
  })

  child.on('close', (code) => {
    job.status = code === 0 ? 'completed' : 'failed'
    job.exitCode = code ?? undefined
    job.completedAt = new Date().toISOString()
    job.output = output.slice(-10000) // Keep last 10KB
    saveJob(job)
  })

  child.on('error', (err) => {
    job.status = 'failed'
    job.completedAt = new Date().toISOString()
    job.output = err.message
    saveJob(job)
  })

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
      `   Output: ~/.freeclaude/jobs/`,
    ].join('\n'),
  }
}
