/**
 * FreeClaude Task Protocol — Main Manager (TypeScript)
 *
 * Converted from dist/task-manager.mjs to TypeScript with full types.
 * This file is compiled SEPARATELY from the main bundle.
 *
 * Manages: task creation, listing, cancellation, templates, schedules.
 * Storage: ~/.freeclaude/{jobs,tasks,schedules}/
 */

import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import type {
  TaskTemplate,
  TaskMetadata,
  TaskRecord,
  TaskEvent,
  ScheduleRecord,
  ScheduleEvent,
} from './types.js'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT_DIR = join(homedir(), '.freeclaude')
const JOBS_DIR = join(ROOT_DIR, 'jobs')
const INDEX_PATH = join(JOBS_DIR, 'index.jsonl')
const TASKS_DIR = join(ROOT_DIR, 'tasks')
const SCHEDULES_DIR = join(ROOT_DIR, 'schedules')
const SCHEDULES_INDEX_PATH = join(SCHEDULES_DIR, 'index.jsonl')
const RUNNER_PATH = fileURLToPath(new URL('./task-runner.mjs', import.meta.url))
const SCHEDULER_PATH = fileURLToPath(new URL('./task-scheduler.mjs', import.meta.url))

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'pr-review',
    title: 'PR review',
    description: 'Review the current repository changes and summarize risks, regressions, and missing tests.',
    prompt: 'Review the current repository changes. Summarize the most important risks, likely regressions, and missing tests before merge.',
  },
  {
    id: 'issue-triage',
    title: 'Issue triage',
    description: 'Triage a bug or issue report and propose reproduction steps, likely causes, and next actions.',
    prompt: 'Triage the current issue context. Identify reproduction steps, likely root causes, open questions, and the best next engineering actions.',
  },
  {
    id: 'reproduce-bug',
    title: 'Reproduce bug',
    description: 'Try to reproduce a bug from the current workspace and summarize what fails and why.',
    prompt: 'Reproduce the bug in the current repository context. Summarize the failing path, observable symptoms, and the most likely root cause.',
  },
  {
    id: 'refactor-with-tests',
    title: 'Refactor with tests',
    description: 'Refactor an area safely and describe the test coverage needed to keep behavior stable.',
    prompt: 'Refactor the target area while preserving behavior. Describe the safest sequence of changes and the tests that should protect the refactor.',
  },
  {
    id: 'release-notes',
    title: 'Generate release notes',
    description: 'Summarize notable changes for release notes from the current repository state.',
    prompt: 'Generate release notes from the current repository changes. Group changes by user impact and call out any migration or rollout notes.',
  },
  {
    id: 'summarize-changes',
    title: 'Summarize changed files',
    description: 'Summarize the changed files in the current workspace and explain the impact succinctly.',
    prompt: 'Summarize the changed files in the current workspace. Explain what changed, why it matters, and any risky or incomplete areas.',
  },
]

// ---------------------------------------------------------------------------
// File utilities
// ---------------------------------------------------------------------------

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

function ensureJobsDir(): void { ensureDir(JOBS_DIR) }
function ensureTasksDir(): void { ensureDir(TASKS_DIR) }
function ensureSchedulesDir(): void { ensureDir(SCHEDULES_DIR) }

function getTaskDir(id: string): string { return join(TASKS_DIR, id) }
function getTaskStatePath(id: string): string { return join(getTaskDir(id), 'task.json') }
function getTaskEventsPath(id: string): string { return join(getTaskDir(id), 'events.jsonl') }

function ensureTaskDir(id: string): void {
  ensureTasksDir()
  ensureDir(getTaskDir(id))
}

function getScheduleDir(id: string): string { return join(SCHEDULES_DIR, id) }
function getScheduleStatePath(id: string): string { return join(getScheduleDir(id), 'schedule.json') }
function getScheduleEventsPath(id: string): string { return join(getScheduleDir(id), 'events.jsonl') }

function ensureScheduleDir(id: string): void {
  ensureSchedulesDir()
  ensureDir(getScheduleDir(id))
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf-8')) as T }
  catch { return null }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function writeTaskState(job: TaskRecord): void {
  ensureTaskDir(job.id)
  writeFileSync(getTaskStatePath(job.id), JSON.stringify(job, null, 2) + '\n')
}

function appendTaskEvent(id: string, event: Omit<TaskEvent, 'timestamp'>): void {
  ensureTaskDir(id)
  appendFileSync(
    getTaskEventsPath(id),
    JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n',
  )
}

function appendJobRecord(job: TaskRecord): void {
  ensureJobsDir()
  appendFileSync(INDEX_PATH, JSON.stringify(job) + '\n')
}

function writeScheduleState(schedule: ScheduleRecord): void {
  ensureScheduleDir(schedule.id)
  writeFileSync(getScheduleStatePath(schedule.id), JSON.stringify(schedule, null, 2) + '\n')
}

function appendScheduleEvent(id: string, event: Omit<ScheduleEvent, 'timestamp'>): void {
  ensureScheduleDir(id)
  appendFileSync(
    getScheduleEventsPath(id),
    JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n',
  )
}

function appendScheduleRecord(schedule: ScheduleRecord): void {
  ensureSchedulesDir()
  appendFileSync(SCHEDULES_INDEX_PATH, JSON.stringify(schedule) + '\n')
}

// ---------------------------------------------------------------------------
// Index readers
// ---------------------------------------------------------------------------

function readIndexRecords<T>(indexPath: string): T[] {
  if (!existsSync(indexPath)) return []
  return readFileSync(indexPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line) as T } catch { return null } })
    .filter((x): x is T => x !== null)
}

function sortByCreatedAtDesc<T extends { createdAt: string }>(records: T[]): T[] {
  return records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getLatestJobs(): TaskRecord[] {
  const latest = new Map<string, TaskRecord>()
  for (const event of readIndexRecords<TaskRecord>(INDEX_PATH)) {
    latest.set(event.id, event)
  }
  if (existsSync(TASKS_DIR)) {
    for (const entry of readdirSync(TASKS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const taskState = readJsonFile<TaskRecord>(getTaskStatePath(entry.name))
      if (taskState?.id) {
        latest.set(taskState.id, { ...latest.get(taskState.id)!, ...taskState })
      }
    }
  }
  return sortByCreatedAtDesc(Array.from(latest.values()))
}

export function getLatestSchedules(): ScheduleRecord[] {
  const latest = new Map<string, ScheduleRecord>()
  for (const event of readIndexRecords<ScheduleRecord>(SCHEDULES_INDEX_PATH)) {
    latest.set(event.id, event)
  }
  if (existsSync(SCHEDULES_DIR)) {
    for (const entry of readdirSync(SCHEDULES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const scheduleState = readJsonFile<ScheduleRecord>(getScheduleStatePath(entry.name))
      if (scheduleState?.id) {
        latest.set(scheduleState.id, { ...latest.get(scheduleState.id)!, ...scheduleState })
      }
    }
  }
  return sortByCreatedAtDesc(Array.from(latest.values()))
}

export function findJob(id: string): TaskRecord | undefined {
  const jobs = getLatestJobs()
  return jobs.find(job => job.id === id) || jobs.find(job => job.id.startsWith(id))
}

export function findSchedule(id: string): ScheduleRecord | undefined {
  const schedules = getLatestSchedules()
  return schedules.find(s => s.id === id) || schedules.find(s => s.id.startsWith(id))
}

function findTemplate(id: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find(t => t.id === id)
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function printText(lines: string | string[]): void {
  console.log(Array.isArray(lines) ? lines.join('\n') : lines)
}

export function formatTaskSummary(job: TaskRecord): string {
  return [
    `Task ${job.id}`,
    `  Status: ${job.status}`,
    `  Prompt: ${job.prompt}`,
    `  Created: ${job.createdAt}`,
    job.completedAt ? `  Completed: ${job.completedAt}` : null,
    job.pid ? `  PID: ${job.pid}` : null,
  ].filter(Boolean).join('\n')
}

export function formatScheduleSummary(schedule: ScheduleRecord): string {
  return [
    `Schedule ${schedule.id}`,
    `  Status: ${schedule.status}`,
    `  Every: ${schedule.everyMinutes} minute(s)`,
    `  Prompt: ${schedule.prompt}`,
    `  Created: ${schedule.createdAt}`,
    schedule.nextRunAt ? `  Next run: ${schedule.nextRunAt}` : null,
    schedule.lastRunAt ? `  Last run: ${schedule.lastRunAt}` : null,
    schedule.lastTaskId ? `  Last task: ${schedule.lastTaskId}` : null,
    schedule.pid ? `  PID: ${schedule.pid}` : null,
  ].filter(Boolean).join('\n')
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildPrompt(promptArgs: string[], templateId: string | null): string {
  const extraContext = promptArgs.join(' ').trim()
  if (!templateId) return extraContext
  const template = findTemplate(templateId)
  if (!template) throw new Error(`Unknown template: ${templateId}`)
  return extraContext
    ? `${template.prompt}\n\nAdditional context:\n${extraContext}`
    : template.prompt
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

interface RunOptions {
  templateId: string | null
  prompt: string
}

function parseRunOptions(args: string[]): RunOptions {
  let templateId: string | null = null
  const promptArgs: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--template') {
      templateId = args[i + 1] ?? null
      i++
      continue
    }
    promptArgs.push(arg!)
  }

  return { templateId, prompt: buildPrompt(promptArgs, templateId) }
}

export function startDetachedTask(prompt: string, metadata: Partial<TaskMetadata> = {}): TaskRecord {
  const id = randomUUID().slice(0, 8)
  const createdAt = new Date().toISOString()
  const cwd = metadata.cwd || process.cwd()
  const taskMetadata: TaskMetadata = {
    cwd,
    source: metadata.source || 'cli',
    templateId: metadata.templateId ?? null,
    scheduleId: metadata.scheduleId ?? null,
    scheduled: Boolean(metadata.scheduleId),
  }

  const runner = spawn(process.execPath, [RUNNER_PATH, id, prompt], {
    cwd,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CLAUDE_CODE_USE_OPENAI: '1',
      FREECLAUDE_TASK_METADATA: JSON.stringify(taskMetadata),
    },
  })
  runner.unref()

  const job: TaskRecord = {
    id,
    prompt,
    status: 'running',
    createdAt,
    updatedAt: createdAt,
    pid: runner.pid,
    ...taskMetadata,
    metadataPath: getTaskStatePath(id),
    eventsPath: getTaskEventsPath(id),
  }

  appendJobRecord(job)
  writeTaskState(job)
  appendTaskEvent(id, { type: 'task_started', prompt, pid: runner.pid, ...taskMetadata })
  return job
}

// ---------------------------------------------------------------------------
// CLI command handlers
// ---------------------------------------------------------------------------

async function runTask(args: string[], json: boolean, metadata: Partial<TaskMetadata> = {}): Promise<number> {
  let prompt: string
  let templateId: string | null = null

  try {
    const options = parseRunOptions(args)
    prompt = options.prompt
    templateId = options.templateId
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Invalid task template'
    json ? printJson({ error: msg }) : printText(msg)
    return 1
  }

  if (!prompt) {
    const usage = 'Usage: freeclaude task run --json [--template <template-id>] <prompt>'
    json ? printJson({ error: usage }) : printText(usage)
    return 1
  }

  const job = startDetachedTask(prompt, { ...metadata, templateId: metadata.templateId ?? templateId })
  if (json) {
    printJson(job)
  } else {
    printText(['🚀 Background task started', `  ID: ${job.id}`, `  PID: ${job.pid}`, `  Prompt: ${job.prompt}`])
  }
  return 0
}

async function listTasks(json: boolean): Promise<number> {
  const jobs = getLatestJobs()
  if (json) {
    printJson({ tasks: jobs })
  } else if (jobs.length === 0) {
    printText('No tasks yet. Use `freeclaude task run --json "<prompt>"` to start one.')
  } else {
    printText(jobs.map(formatTaskSummary))
  }
  return 0
}

async function resumeTask(args: string[], json: boolean): Promise<number> {
  const id = args[0]?.trim()
  if (!id) {
    const usage = 'Usage: freeclaude task resume --json <id>'
    json ? printJson({ error: usage }) : printText(usage)
    return 1
  }

  const job = findJob(id)
  if (!job) {
    json ? printJson({ error: `Task ${id} not found` }) : printText(`Task ${id} not found`)
    return 1
  }

  json ? printJson(job) : printText(formatTaskSummary(job))
  return 0
}

async function cancelTask(args: string[], json: boolean): Promise<number> {
  const id = args[0]?.trim()
  if (!id) {
    const usage = 'Usage: freeclaude task cancel --json <id>'
    json ? printJson({ error: usage }) : printText(usage)
    return 1
  }

  const job = findJob(id)
  if (!job) {
    json ? printJson({ error: `Task ${id} not found` }) : printText(`Task ${id} not found`)
    return 1
  }

  if (job.status !== 'running' || !job.pid) {
    if (json) {
      printJson({ task: job, cancelled: false, reason: 'Task is not running' })
    } else {
      printText(`Task ${job.id} is not running.`)
    }
    return 0
  }

  appendTaskEvent(job.id, { type: 'task_cancel_requested', pid: job.pid })

  try {
    process.kill(job.pid, 'SIGTERM')
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to send SIGTERM'
    if (json) {
      printJson({ task: job, cancelled: false, reason: msg })
    } else {
      printText(`Failed to cancel task ${job.id}.`)
    }
    return 1
  }

  const now = new Date().toISOString()
  const cancellationRecord: TaskRecord = {
    ...job,
    status: 'failed',
    completedAt: now,
    updatedAt: now,
    exitCode: 143,
    output: 'Cancelled by user.',
  }
  appendJobRecord(cancellationRecord)
  writeTaskState(cancellationRecord)

  if (json) {
    printJson({ task: cancellationRecord, cancelled: true })
  } else {
    printText(`Cancelled task ${job.id}.`)
  }
  return 0
}

async function listTemplates(json: boolean): Promise<number> {
  if (json) {
    printJson({ templates: TASK_TEMPLATES })
  } else {
    printText(TASK_TEMPLATES.map(t => `${t.id} — ${t.title}\n  ${t.description}`))
  }
  return 0
}

async function runTemplate(args: string[], json: boolean): Promise<number> {
  const [templateId, ...extraContext] = args
  if (!templateId) {
    const usage = 'Usage: freeclaude task template run --json <template-id> [context]'
    json ? printJson({ error: usage }) : printText(usage)
    return 1
  }
  return runTask(['--template', templateId, ...extraContext], json, { templateId })
}

async function handleTemplateCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args
  const json = rest.includes('--json')
  const filteredArgs = rest.filter(a => a !== '--json')

  switch (subcommand) {
    case 'list': return listTemplates(json)
    case 'run': return runTemplate(filteredArgs, json)
    default:
      const usage = 'Usage: freeclaude task template <list|run> --json ...'
      json ? printJson({ error: usage }) : printText(usage)
      return 1
  }
}

// ---------------------------------------------------------------------------
// Schedule management
// ---------------------------------------------------------------------------

interface ScheduleOptions {
  everyMinutes: number
  templateId: string | null
  prompt: string
}

function parseScheduleOptions(args: string[]): ScheduleOptions {
  let everyMinutes = 60
  let templateId: string | null = null
  const promptArgs: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--every') {
      everyMinutes = Number(args[i + 1] ?? NaN)
      i++
      continue
    }
    if (arg === '--template') {
      templateId = args[i + 1] ?? null
      i++
      continue
    }
    promptArgs.push(arg!)
  }

  if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) {
    throw new Error('Schedule interval must be a positive number of minutes')
  }

  return { everyMinutes, templateId, prompt: buildPrompt(promptArgs, templateId) }
}

async function runSchedule(args: string[], json: boolean): Promise<number> {
  let options: ScheduleOptions
  try {
    options = parseScheduleOptions(args)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Invalid schedule options'
    json ? printJson({ error: msg }) : printText(msg)
    return 1
  }

  if (!options.prompt) {
    const usage = 'Usage: freeclaude task schedule run --json --every <minutes> [--template <template-id>] <prompt>'
    json ? printJson({ error: usage }) : printText(usage)
    return 1
  }

  const id = randomUUID().slice(0, 8)
  const createdAt = new Date().toISOString()
  const scheduleMeta = {
    cwd: process.cwd(),
    source: 'cli' as const,
    templateId: options.templateId ?? null,
  }

  const scheduler = spawn(
    process.execPath,
    [SCHEDULER_PATH, id, String(options.everyMinutes), options.prompt],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        CLAUDE_CODE_USE_OPENAI: '1',
        FREECLAUDE_SCHEDULE_METADATA: JSON.stringify(scheduleMeta),
      },
    },
  )
  scheduler.unref()

  const schedule: ScheduleRecord = {
    id,
    prompt: options.prompt,
    everyMinutes: options.everyMinutes,
    status: 'running',
    createdAt,
    updatedAt: createdAt,
    nextRunAt: createdAt,
    lastRunAt: null,
    lastTaskId: null,
    pid: scheduler.pid,
    ...scheduleMeta,
    metadataPath: getScheduleStatePath(id),
    eventsPath: getScheduleEventsPath(id),
  }

  appendScheduleRecord(schedule)
  writeScheduleState(schedule)
  appendScheduleEvent(id, {
    type: 'schedule_started',
    everyMinutes: options.everyMinutes,
    prompt: options.prompt,
    pid: scheduler.pid,
    ...scheduleMeta,
  })

  if (json) {
    printJson(schedule)
  } else {
    printText([
      '🗓️ Recurring task schedule started',
      `  ID: ${schedule.id}`,
      `  Every: ${schedule.everyMinutes} minute(s)`,
      `  PID: ${schedule.pid}`,
      `  Prompt: ${schedule.prompt}`,
    ])
  }
  return 0
}

async function listSchedules(json: boolean): Promise<number> {
  const schedules = getLatestSchedules()
  if (json) {
    printJson({ schedules })
  } else if (schedules.length === 0) {
    printText('No schedules yet. Use `freeclaude task schedule run --json --every 60 "<prompt>"`.')
  } else {
    printText(schedules.map(formatScheduleSummary))
  }
  return 0
}

async function cancelSchedule(args: string[], json: boolean): Promise<number> {
  const id = args[0]?.trim()
  if (!id) {
    const usage = 'Usage: freeclaude task schedule cancel --json <id>'
    json ? printJson({ error: usage }) : printText(usage)
    return 1
  }

  const schedule = findSchedule(id)
  if (!schedule) {
    json ? printJson({ error: `Schedule ${id} not found` }) : printText(`Schedule ${id} not found`)
    return 1
  }

  if (schedule.status !== 'running' || !schedule.pid) {
    if (json) {
      printJson({ schedule, cancelled: false, reason: 'Schedule is not running' })
    } else {
      printText(`Schedule ${schedule.id} is not running.`)
    }
    return 0
  }

  appendScheduleEvent(schedule.id, { type: 'schedule_cancel_requested', pid: schedule.pid })

  try {
    process.kill(schedule.pid, 'SIGTERM')
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to send SIGTERM'
    if (json) {
      printJson({ schedule, cancelled: false, reason: msg })
    } else {
      printText(`Failed to cancel schedule ${schedule.id}.`)
    }
    return 1
  }

  const now = new Date().toISOString()
  const cancellationRecord: ScheduleRecord = {
    ...schedule,
    status: 'cancelled',
    updatedAt: now,
  }
  appendScheduleRecord(cancellationRecord)
  writeScheduleState(cancellationRecord)

  if (json) {
    printJson({ schedule: cancellationRecord, cancelled: true })
  } else {
    printText(`Cancelled schedule ${schedule.id}.`)
  }
  return 0
}

async function handleScheduleCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args
  const json = rest.includes('--json')
  const filteredArgs = rest.filter(a => a !== '--json')

  switch (subcommand) {
    case 'run': return runSchedule(filteredArgs, json)
    case 'list': return listSchedules(json)
    case 'cancel': return cancelSchedule(filteredArgs, json)
    default:
      const usage = 'Usage: freeclaude task schedule <run|list|cancel> --json ...'
      json ? printJson({ error: usage }) : printText(usage)
      return 1
  }
}

// ---------------------------------------------------------------------------
// Main command router
// ---------------------------------------------------------------------------

export async function handleTaskCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args
  const json = rest.includes('--json')
  const filteredArgs = rest.filter(a => a !== '--json')

  switch (subcommand) {
    case 'run': return runTask(filteredArgs, json)
    case 'list': return listTasks(json)
    case 'resume': return resumeTask(filteredArgs, json)
    case 'cancel': return cancelTask(filteredArgs, json)
    case 'template': return handleTemplateCommand(rest)
    case 'schedule': return handleScheduleCommand(rest)
    default:
      const usage = 'Usage: freeclaude task <run|list|resume|cancel|template|schedule> --json ...'
      json ? printJson({ error: usage }) : printText(usage)
      return 1
  }
}
