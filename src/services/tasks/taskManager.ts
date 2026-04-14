import {
  spawn,
  spawnSync,
  type ChildProcessByStdio,
} from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Readable } from 'node:stream'
import { createInterface } from 'node:readline'
import { getStats, type UsageStats } from '../usage/usageStore.js'
import { getVoiceStatus } from '../voice/voiceService.js'

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type TaskReviewState = 'pending' | 'approved' | 'rejected'

export type TaskTemplateId =
  | 'custom'
  | 'pr-review'
  | 'issue-triage'
  | 'reproduce-bug'
  | 'refactor-with-tests'
  | 'release-notes'
  | 'summarize-changed-files'

export interface TaskTemplate {
  id: TaskTemplateId
  title: string
  description: string
  promptPrefix: string
}

export interface TaskRecord {
  id: string
  shortId: string
  inputPrompt: string
  prompt: string
  template: TaskTemplateId
  status: TaskStatus
  reviewState?: TaskReviewState
  cwd: string
  worktreePath?: string
  repoRoot?: string
  repoSlug?: string
  pid?: number
  sessionId?: string
  provider?: string
  model?: string
  totalCostUsd?: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  artifactPath?: string
  diffPath?: string
  vaultNotePath?: string
  projectNotePath?: string
  pinned?: boolean
  archivedAt?: string
  summary?: string
  resultPreview?: string
  errorMessage?: string
  resumedFromTaskId?: string
  useWorktree: boolean
}

export type TaskEventType =
  | 'task_started'
  | 'message_delta'
  | 'tool_request'
  | 'tool_result'
  | 'approval_required'
  | 'artifact_created'
  | 'git_diff_ready'
  | 'task_completed'
  | 'task_failed'
  | 'diagnostic'

export interface TaskEvent {
  id: string
  taskId: string
  type: TaskEventType
  timestamp: string
  data?: Record<string, unknown>
}

export interface TaskDetail {
  task: TaskRecord
  events: TaskEvent[]
  artifact?: string
}

export interface RuntimeProvider {
  name: string
  model?: string
  baseUrl?: string
  priority?: number
}

export interface RuntimeOverview {
  freeclaudeHome: string
  providers: RuntimeProvider[]
  configured: boolean
  voice: ReturnType<typeof getVoiceStatus>
  usage: UsageStats
  recommendedNextStep: string
}

type CreateTaskOptions = {
  cwd?: string
  template?: TaskTemplateId
  useWorktree?: boolean
  resumedFromTaskId?: string
}

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'custom',
    title: 'Custom Task',
    description: 'Free-form background task for the current workspace.',
    promptPrefix: '',
  },
  {
    id: 'pr-review',
    title: 'PR Review',
    description: 'Review the current branch like a careful senior engineer.',
    promptPrefix:
      'Review the current branch and working tree like a senior engineer. Focus on correctness, regressions, missing tests, risky assumptions, and concrete next fixes. End with a concise actionable summary.',
  },
  {
    id: 'issue-triage',
    title: 'Issue Triage',
    description: 'Classify, scope, and suggest the next best engineering action.',
    promptPrefix:
      'Triage the issue in this repository. Clarify likely root cause, impacted areas, missing context, risk, and the smallest safe next step. If information is incomplete, list the exact evidence that should be gathered.',
  },
  {
    id: 'reproduce-bug',
    title: 'Reproduce Bug',
    description: 'Try to reproduce a bug and leave a crisp investigation trail.',
    promptPrefix:
      'Try to reproduce the reported bug in this repository. Document the repro path, findings, likely root cause, and concrete remediation ideas. If the bug is not reproducible, explain what blocked it.',
  },
  {
    id: 'refactor-with-tests',
    title: 'Refactor With Tests',
    description: 'Refactor safely and add or strengthen tests.',
    promptPrefix:
      'Refactor the targeted code safely. Prefer smaller, composable changes, preserve behavior, and add or improve tests that lock in the intended behavior.',
  },
  {
    id: 'release-notes',
    title: 'Release Notes',
    description: 'Summarize the latest meaningful product and engineering changes.',
    promptPrefix:
      'Generate release notes for the latest meaningful changes in this repository. Group by user-facing impact, mention risks, and keep the writing crisp and honest.',
  },
  {
    id: 'summarize-changed-files',
    title: 'Summarize Changed Files',
    description: 'Summarize what changed and why it matters.',
    promptPrefix:
      'Summarize the currently changed files. Explain what changed, why it matters, and what should be checked before merging.',
  },
]

const MAX_EVENTS_PER_TASK = 500

function nowIso(): string {
  return new Date().toISOString()
}

function freeclaudeHome(): string {
  return process.env.FREECLAUDE_HOME || join(homedir(), '.freeclaude')
}

function configPath(): string {
  return process.env.FREECLAUDE_CONFIG_PATH || join(homedir(), '.freeclaude.json')
}

function tasksDir(): string {
  return join(freeclaudeHome(), 'tasks')
}

function artifactsDir(): string {
  return join(freeclaudeHome(), 'artifacts')
}

function worktreesDir(): string {
  return join(freeclaudeHome(), 'worktrees')
}

function vaultDir(): string {
  return join(freeclaudeHome(), 'vault')
}

function vaultTasksDir(): string {
  return join(vaultDir(), 'tasks')
}

function vaultProjectsDir(): string {
  return join(vaultDir(), 'projects')
}

function vaultArchiveDir(): string {
  return join(vaultDir(), 'archive')
}

function ensureTaskDirectories(): void {
  for (const dir of [
    freeclaudeHome(),
    tasksDir(),
    artifactsDir(),
    worktreesDir(),
    vaultDir(),
    vaultTasksDir(),
    vaultProjectsDir(),
    vaultArchiveDir(),
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }
  try {
    const staleTempFiles = readdirSync(tasksDir()).filter(file =>
      file.endsWith('.tmp'),
    )
    for (const file of staleTempFiles) {
      const path = join(tasksDir(), file)
      const ageMs = Date.now() - statSync(path).mtimeMs
      if (ageMs > 60_000) {
        unlinkSync(path)
      }
    }
  } catch {
    // Best effort cleanup only.
  }
}

function taskRecordPath(taskId: string): string {
  return join(tasksDir(), `${taskId}.json`)
}

function taskEventsPath(taskId: string): string {
  return join(tasksDir(), `${taskId}.events.jsonl`)
}

function taskRawStreamPath(taskId: string): string {
  return join(tasksDir(), `${taskId}.stream.log`)
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf-8')
  renameSync(tempPath, path)
}

function appendJsonLine(path: string, value: unknown): void {
  appendFileSync(path, JSON.stringify(value) + '\n', 'utf-8')
}

function sanitizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'workspace'
}

function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: string }).type === 'text'
      ) {
        return String((block as { text?: string }).text ?? '')
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function readTaskRecord(path: string): TaskRecord | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as TaskRecord
  } catch {
    return null
  }
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

function normalizeTaskHealth(task: TaskRecord): TaskRecord {
  if (task.status === 'running' && !isProcessAlive(task.pid)) {
    const staleTask: TaskRecord = {
      ...task,
      status: 'failed',
      updatedAt: nowIso(),
      completedAt: task.completedAt ?? nowIso(),
      errorMessage:
        task.errorMessage ?? 'Task worker exited before writing a final result.',
      summary: task.summary ?? 'Task worker exited unexpectedly.',
    }
    saveTask(staleTask)
    appendTaskEvent(task.id, 'task_failed', {
      errorMessage: staleTask.errorMessage,
      reason: 'stale_worker',
    })
    return staleTask
  }
  return task
}

export function saveTask(task: TaskRecord): TaskRecord {
  ensureTaskDirectories()
  writeJsonAtomic(taskRecordPath(task.id), task)
  return task
}

export function updateTask(
  taskId: string,
  updater: Partial<TaskRecord> | ((task: TaskRecord) => TaskRecord),
): TaskRecord {
  const current = getTask(taskId)
  if (!current) {
    throw new Error(`Task "${taskId}" not found`)
  }
  const next =
    typeof updater === 'function'
      ? updater(current)
      : {
          ...current,
          ...updater,
          updatedAt: updater.updatedAt ?? nowIso(),
        }
  return saveTask(next)
}

export function getTask(taskId: string): TaskRecord | null {
  ensureTaskDirectories()
  const exactPath = taskRecordPath(taskId)
  if (existsSync(exactPath)) {
    const exact = readTaskRecord(exactPath)
    return exact ? normalizeTaskHealth(exact) : null
  }

  const candidates = readdirSync(tasksDir())
    .filter(name => name.endsWith('.json') && !name.endsWith('.events.jsonl'))
    .map(name => join(tasksDir(), name))
    .map(readTaskRecord)
    .filter((task): task is TaskRecord => task !== null)
    .filter(task => task.id.startsWith(taskId) || task.shortId.startsWith(taskId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  if (candidates.length === 0) return null
  return normalizeTaskHealth(candidates[0]!)
}

export function listTasks(options: {
  limit?: number
  status?: TaskStatus
  includeArchived?: boolean
} = {}): TaskRecord[] {
  ensureTaskDirectories()
  const records = readdirSync(tasksDir())
    .filter(name => name.endsWith('.json'))
    .filter(name => !name.endsWith('.events.jsonl'))
    .map(name => join(tasksDir(), name))
    .map(readTaskRecord)
    .filter((task): task is TaskRecord => task !== null)
    .map(normalizeTaskHealth)
    .filter(task => (options.includeArchived ? true : !task.archivedAt))
    .filter(task => (options.status ? task.status === options.status : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return typeof options.limit === 'number' ? records.slice(0, options.limit) : records
}

export function readTaskEvents(taskId: string, limit?: number): TaskEvent[] {
  ensureTaskDirectories()
  const path = taskEventsPath(taskId)
  if (!existsSync(path)) return []
  const events = readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as TaskEvent
      } catch {
        return null
      }
    })
    .filter((event): event is TaskEvent => event !== null)

  return typeof limit === 'number' ? events.slice(-limit) : events
}

export function appendTaskEvent(
  taskId: string,
  type: TaskEventType,
  data?: Record<string, unknown>,
): TaskEvent {
  ensureTaskDirectories()
  const event: TaskEvent = {
    id: randomUUID(),
    taskId,
    type,
    timestamp: nowIso(),
    ...(data ? { data } : {}),
  }
  appendJsonLine(taskEventsPath(taskId), event)
  pruneOldEvents(taskId)
  return event
}

function pruneOldEvents(taskId: string): void {
  const path = taskEventsPath(taskId)
  if (!existsSync(path)) {
    return
  }
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean)
  if (lines.length <= MAX_EVENTS_PER_TASK) {
    return
  }
  const pruned = lines.slice(lines.length - MAX_EVENTS_PER_TASK)
  writeFileSync(path, `${pruned.join('\n')}\n`, 'utf-8')
}

function getTemplateById(id: TaskTemplateId | undefined): TaskTemplate {
  if (id === undefined || id === 'custom') {
    return TASK_TEMPLATES[0]!
  }
  const template = TASK_TEMPLATES.find(candidate => candidate.id === id)
  if (!template) {
    const valid = TASK_TEMPLATES.map(candidate => candidate.id).join(', ')
    throw new Error(`Unknown template "${id}". Valid templates: ${valid}`)
  }
  return template
}

function buildTaskPrompt(inputPrompt: string, templateId: TaskTemplateId): string {
  const template = getTemplateById(templateId)
  const trimmed = inputPrompt.trim()
  if (!template.promptPrefix) {
    return trimmed
  }
  if (!trimmed) {
    return template.promptPrefix
  }
  return `${template.promptPrefix}\n\nWorkspace-specific context:\n${trimmed}`
}

function inferRepoRoot(cwd: string): string | undefined {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0) return undefined
  const output = result.stdout.trim()
  return output || undefined
}

function createDetachedWorktree(task: TaskRecord): {
  repoRoot?: string
  repoSlug?: string
  worktreePath?: string
  diagnostics?: string[]
} {
  const repoRoot = inferRepoRoot(task.cwd)
  if (!repoRoot) {
    return {}
  }

  ensureTaskDirectories()
  const repoSlug = sanitizeSlug(basename(repoRoot))
  const path = join(worktreesDir(), `${repoSlug}-${task.shortId}`)

  if (existsSync(path)) {
    return { repoRoot, repoSlug, worktreePath: path }
  }

  const result = spawnSync(
    'git',
    ['-C', repoRoot, 'worktree', 'add', '--detach', path, 'HEAD'],
    {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  if (result.status !== 0) {
    return {
      repoRoot,
      repoSlug,
      diagnostics: [
        `git worktree add failed: ${(result.stderr || result.stdout || '').trim() || 'unknown error'}`,
      ],
    }
  }

  return {
    repoRoot,
    repoSlug,
    worktreePath: path,
  }
}

function resolveCliBundlePath(): string {
  return join(import.meta.dir, '..', '..', '..', 'dist', 'cli.mjs')
}

function createArtifactMarkdown(task: TaskRecord, resultText: string): string {
  const lines = [
    `# Task ${task.shortId}`,
    '',
    `- Status: ${task.status}`,
    `- Template: ${task.template}`,
    `- Created: ${task.createdAt}`,
    `- CWD: ${task.cwd}`,
  ]

  if (task.worktreePath) lines.push(`- Worktree: ${task.worktreePath}`)
  if (task.provider) lines.push(`- Provider: ${task.provider}`)
  if (task.model) lines.push(`- Model: ${task.model}`)
  if (typeof task.totalCostUsd === 'number') {
    lines.push(`- Cost: $${task.totalCostUsd.toFixed(4)}`)
  }

  lines.push('', '## Prompt', '', task.inputPrompt || '(empty)', '', '## Result', '', resultText || '(no result)')

  return lines.join('\n') + '\n'
}

function ensureProjectNote(task: TaskRecord): string | undefined {
  if (!task.repoSlug) return undefined
  ensureTaskDirectories()
  const path = join(vaultProjectsDir(), `${task.repoSlug}.md`)
  const taskLink = `- [[tasks/${task.id}]] — ${task.summary || task.status}`
  if (!existsSync(path)) {
    const lines = [
      '---',
      'type: project',
      `slug: ${task.repoSlug}`,
      `cwd: ${task.repoRoot || task.cwd}`,
      `createdAt: ${task.createdAt}`,
      '---',
      '',
      `# Project ${task.repoSlug}`,
      '',
      '## Recent Tasks',
      '',
      taskLink,
      '',
    ]
    writeFileSync(path, lines.join('\n'), 'utf-8')
    return path
  }

  const content = readFileSync(path, 'utf-8')
  if (!content.includes(`[[tasks/${task.id}]]`)) {
    const updated = content.trimEnd() + '\n' + taskLink + '\n'
    writeFileSync(path, updated, 'utf-8')
  }
  return path
}

function writeTaskVaultNote(task: TaskRecord): string {
  ensureTaskDirectories()
  const notePath = join(vaultTasksDir(), `${task.id}.md`)
  const artifactRel = task.artifactPath ? `../artifacts/${basename(task.artifactPath)}` : undefined
  const diffRel = task.diffPath ? `../artifacts/${basename(task.diffPath)}` : undefined
  const lines = [
    '---',
    'type: task',
    `taskId: ${task.id}`,
    `status: ${task.status}`,
    `reviewState: ${task.reviewState ?? 'pending'}`,
    `template: ${task.template}`,
    `pinned: ${task.pinned ? 'true' : 'false'}`,
    `createdAt: ${task.createdAt}`,
    `updatedAt: ${task.updatedAt}`,
    ...(task.provider ? [`provider: ${task.provider}`] : []),
    ...(task.model ? [`model: ${task.model}`] : []),
    ...(task.repoSlug ? [`repo: ${task.repoSlug}`] : []),
    '---',
    '',
    `# Task ${task.shortId}`,
    '',
    ...(task.repoSlug ? [`Project: [[projects/${task.repoSlug}]]`, ''] : []),
    '## Prompt',
    '',
    task.inputPrompt || '(empty)',
    '',
    '## Outcome',
    '',
    task.summary || task.resultPreview || task.status,
    '',
    '## Links',
    '',
    ...(artifactRel ? [`- [Result Artifact](${artifactRel})`] : []),
    ...(diffRel ? [`- [Diff Patch](${diffRel})`] : []),
    ...(task.worktreePath ? [`- Worktree: \`${task.worktreePath}\``] : []),
    ...(task.cwd ? [`- Repo / CWD: \`${task.cwd}\``] : []),
    '',
  ]
  writeFileSync(notePath, lines.join('\n'), 'utf-8')
  return notePath
}

function rewriteTaskNoteFrontmatter(task: TaskRecord): void {
  if (!task.vaultNotePath || !existsSync(task.vaultNotePath)) return
  let content = readFileSync(task.vaultNotePath, 'utf-8')
  content = content.replace(/^pinned:\s*(true|false)$/m, `pinned: ${task.pinned ? 'true' : 'false'}`)
  content = content.replace(
    /^reviewState:\s*(pending|approved|rejected)$/m,
    `reviewState: ${task.reviewState ?? 'pending'}`,
  )
  content = content.replace(/^status:\s*(.+)$/m, `status: ${task.status}`)
  content = content.replace(/^updatedAt:\s*.+$/m, `updatedAt: ${task.updatedAt}`)
  writeFileSync(task.vaultNotePath, content, 'utf-8')
}

function collectGitDiff(worktreePath: string | undefined, taskId: string): string | undefined {
  if (!worktreePath) return undefined
  const result = spawnSync('git', ['-C', worktreePath, 'diff', '--binary'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) return undefined
  const diff = result.stdout.trim()
  if (!diff) return undefined
  const path = join(artifactsDir(), `${taskId}.diff.patch`)
  writeFileSync(path, diff + '\n', 'utf-8')
  return path
}

function appendRawStream(taskId: string, line: string): void {
  appendFileSync(taskRawStreamPath(taskId), line + '\n', 'utf-8')
}

function summarizeText(text: string, fallback: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (!normalized) return fallback
  return normalized.length > 240 ? normalized.slice(0, 237) + '...' : normalized
}

function detectProviderFromDiagnostics(line: string): string | undefined {
  const parts = line.split('|').map(part => part.trim())
  if (parts.length < 3) return undefined
  const provider = parts[parts.length - 2]
  return provider || undefined
}

function loadConfiguredProviders(): RuntimeProvider[] {
  const path = configPath()
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as {
      providers?: Array<{
        name?: string
        model?: string
        baseUrl?: string
        priority?: number
      }>
    }
    return (raw.providers ?? [])
      .map(provider => ({
        name: provider.name ?? 'unknown',
        ...(provider.model ? { model: provider.model } : {}),
        ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
        ...(typeof provider.priority === 'number'
          ? { priority: provider.priority }
          : {}),
      }))
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
  } catch {
    return []
  }
}

export function getTaskTemplates(): TaskTemplate[] {
  return [...TASK_TEMPLATES]
}

export function getRecommendedRuntimeNextStep(options: {
  providerCount: number
  voiceTranscriptionReady: boolean
}): string {
  if (options.providerCount === 0) {
    return 'Configure at least one provider, then run a sample background task.'
  }

  if (!options.voiceTranscriptionReady) {
    return 'Voice is optional. Finish provider setup first, then install local voice input dependencies only if you want push-to-talk.'
  }

  return 'Run a sample background task to validate the local workflow.'
}

export function getRuntimeOverview(): RuntimeOverview {
  ensureTaskDirectories()
  const providers = loadConfiguredProviders()
  const voice = getVoiceStatus()
  const usage = getStats(7)
  const recommendedNextStep = getRecommendedRuntimeNextStep({
    providerCount: providers.length,
    voiceTranscriptionReady: voice.transcriptionReady,
  })

  return {
    freeclaudeHome: freeclaudeHome(),
    providers,
    configured: providers.length > 0,
    voice,
    usage,
    recommendedNextStep,
  }
}

export function createTask(
  inputPrompt: string,
  options: CreateTaskOptions = {},
): TaskRecord {
  ensureTaskDirectories()
  const template = options.template ?? 'custom'
  const id = randomUUID()
  const createdAt = nowIso()
  const cwd = options.cwd ?? process.cwd()
  const task: TaskRecord = {
    id,
    shortId: id.slice(0, 8),
    inputPrompt: inputPrompt.trim(),
    prompt: buildTaskPrompt(inputPrompt, template),
    template,
    status: 'queued',
    cwd,
    createdAt,
    updatedAt: createdAt,
    useWorktree: options.useWorktree ?? true,
    ...(options.resumedFromTaskId
      ? { resumedFromTaskId: options.resumedFromTaskId }
      : {}),
  }
  return saveTask(task)
}

export function spawnTaskWorker(taskId: string): TaskRecord {
  const task = getTask(taskId)
  if (!task) {
    throw new Error(`Task "${taskId}" not found`)
  }

  const cliPath = resolveCliBundlePath()
  const child = spawn(
    process.execPath,
    [cliPath, 'task', 'worker', task.id],
    {
      cwd: task.cwd,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        CLAUDE_CODE_USE_OPENAI: '1',
      },
    },
  )

  child.unref()

  return updateTask(task.id, {
    pid: child.pid,
    updatedAt: nowIso(),
  })
}

function finalizeTaskSuccess(
  task: TaskRecord,
  resultText: string,
  provider: string | undefined,
  model: string | undefined,
  totalCostUsd: number | undefined,
): TaskRecord {
  ensureTaskDirectories()
  const artifactPath = join(artifactsDir(), `${task.id}.md`)
  const completedAt = nowIso()
  const resultPreview = summarizeText(resultText, 'Task completed without text output.')
  const diffPath = collectGitDiff(task.worktreePath, task.id)

  const completedTask = updateTask(task.id, current => ({
    ...current,
    status: 'completed',
    reviewState: current.reviewState ?? 'pending',
    updatedAt: completedAt,
    completedAt,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(typeof totalCostUsd === 'number' ? { totalCostUsd } : {}),
    artifactPath,
    ...(diffPath ? { diffPath } : {}),
    resultPreview,
    summary: resultPreview,
  }))

  writeFileSync(artifactPath, createArtifactMarkdown(completedTask, resultText), 'utf-8')
  appendTaskEvent(task.id, 'artifact_created', { artifactPath })
  if (diffPath) {
    appendTaskEvent(task.id, 'git_diff_ready', { diffPath })
  }

  const projectNotePath = ensureProjectNote(completedTask)
  const notePath = writeTaskVaultNote({
    ...completedTask,
    ...(projectNotePath ? { projectNotePath } : {}),
  })

  const finalTask = updateTask(task.id, {
    vaultNotePath: notePath,
    ...(projectNotePath ? { projectNotePath } : {}),
    updatedAt: nowIso(),
  })

  appendTaskEvent(task.id, 'task_completed', {
    resultPreview: finalTask.resultPreview,
    artifactPath,
    ...(diffPath ? { diffPath } : {}),
  })
  appendTaskEvent(task.id, 'approval_required', {
    reviewState: finalTask.reviewState ?? 'pending',
    reason: 'result_ready_for_review',
  })
  return finalTask
}

function finalizeTaskFailure(
  task: TaskRecord,
  errorMessage: string,
  status: Extract<TaskStatus, 'failed' | 'cancelled'>,
): TaskRecord {
  const failedTask = updateTask(task.id, {
    status,
    updatedAt: nowIso(),
    completedAt: nowIso(),
    errorMessage,
    summary: summarizeText(errorMessage, status === 'cancelled' ? 'Task cancelled.' : 'Task failed.'),
  })
  appendTaskEvent(task.id, 'task_failed', {
    status,
    errorMessage,
  })
  return failedTask
}

export async function runTaskWorker(taskId: string): Promise<TaskRecord> {
  const existingTask = getTask(taskId)
  if (!existingTask) {
    throw new Error(`Task "${taskId}" not found`)
  }
  let task: TaskRecord = existingTask

  const worktree = task.useWorktree ? createDetachedWorktree(task) : {}
  task = updateTask(task.id, current => ({
    ...current,
    status: 'running',
    startedAt: current.startedAt ?? nowIso(),
    updatedAt: nowIso(),
    pid: process.pid,
    ...(worktree.repoRoot ? { repoRoot: worktree.repoRoot } : {}),
    ...(worktree.repoSlug ? { repoSlug: worktree.repoSlug } : {}),
    ...(worktree.worktreePath ? { worktreePath: worktree.worktreePath } : {}),
  }))

  appendTaskEvent(task.id, 'task_started', {
    cwd: task.cwd,
    ...(task.worktreePath ? { worktreePath: task.worktreePath } : {}),
  })

  for (const diagnostic of worktree.diagnostics ?? []) {
    appendTaskEvent(task.id, 'diagnostic', { stream: 'system', line: diagnostic })
  }

  let child: ChildProcessByStdio<null, Readable, Readable> | null = null
  let finalized = false

  const terminateChild = () => {
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM')
      } catch {
        // Best effort only.
      }
    }
  }

  process.on('SIGTERM', () => {
    if (finalized) return
    terminateChild()
    finalizeTaskFailure(task!, 'Cancelled from desktop or CLI.', 'cancelled')
    finalized = true
    process.exit(0)
  })

  process.on('SIGINT', () => {
    if (finalized) return
    terminateChild()
    finalizeTaskFailure(task!, 'Cancelled from desktop or CLI.', 'cancelled')
    finalized = true
    process.exit(0)
  })

  const cliPath = resolveCliBundlePath()
  const resultChunks: string[] = []
  let inferredProvider = task.provider
  let inferredModel = task.model
  let totalCostUsd = task.totalCostUsd
  let streamErrorMessage = ''

  child = spawn(
    process.execPath,
    [
      cliPath,
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--',
      task.prompt,
    ],
    {
      cwd: task.worktreePath || task.cwd,
      env: {
        ...process.env,
        CLAUDE_CODE_USE_OPENAI: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  const handleLine = (line: string, stream: 'stdout' | 'stderr') => {
    const trimmed = line.trim()
    if (!trimmed) return
    appendRawStream(task.id, trimmed)

    let parsed: Record<string, unknown> | null = null
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      parsed = null
    }

    if (!parsed) {
      appendTaskEvent(task.id, 'diagnostic', { stream, line: trimmed })
      inferredProvider = inferredProvider ?? detectProviderFromDiagnostics(trimmed)
      if (stream === 'stderr') {
        streamErrorMessage = trimmed
      }
      return
    }

    if (parsed.type === 'system' && parsed.subtype === 'init') {
      task = updateTask(task.id, {
        sessionId:
          typeof parsed.session_id === 'string' ? parsed.session_id : task.sessionId,
        updatedAt: nowIso(),
      })
      appendTaskEvent(task.id, 'diagnostic', {
        stream,
        line: 'stream_json_init',
        sessionId: parsed.session_id,
      })
      return
    }

    if (parsed.type === 'assistant') {
      const text = extractAssistantText(parsed.message)
      if (text) {
        resultChunks.push(text)
        appendTaskEvent(task.id, 'message_delta', { text })
      }
      const message = parsed.message as { model?: string } | undefined
      if (message?.model) {
        inferredModel = message.model
      }
      return
    }

    if (parsed.type === 'stream_event') {
      const event = parsed.event as Record<string, unknown> | undefined
      if (!event) return
      const eventType = event.type
      if (
        eventType === 'content_block_start' &&
        typeof event.content_block === 'object' &&
        event.content_block &&
        (event.content_block as { type?: string }).type === 'tool_use'
      ) {
        appendTaskEvent(task.id, 'tool_request', {
          toolName: (event.content_block as { name?: string }).name,
        })
      } else if (eventType === 'content_block_stop') {
        appendTaskEvent(task.id, 'tool_result', {})
      }
      return
    }

    if (parsed.type === 'result') {
      const resultValue =
        typeof parsed.result === 'string' ? parsed.result : resultChunks.join('\n\n')
      const modelUsage =
        parsed.modelUsage &&
        typeof parsed.modelUsage === 'object' &&
        !Array.isArray(parsed.modelUsage)
          ? (parsed.modelUsage as Record<string, unknown>)
          : undefined
      const firstModel = modelUsage ? Object.keys(modelUsage)[0] : undefined
      inferredModel = inferredModel ?? firstModel
      totalCostUsd =
        typeof parsed.total_cost_usd === 'number'
          ? parsed.total_cost_usd
          : totalCostUsd

      if (parsed.subtype === 'success' && parsed.is_error !== true) {
        task = finalizeTaskSuccess(
          task,
          resultValue || resultChunks.join('\n\n'),
          inferredProvider,
          inferredModel,
          totalCostUsd,
        )
      } else {
        const errorMessage = summarizeText(
          resultValue || streamErrorMessage || 'Task failed.',
          'Task failed.',
        )
        task = finalizeTaskFailure(task, errorMessage, 'failed')
      }
      finalized = true
      return
    }

    appendTaskEvent(task.id, 'diagnostic', {
      stream,
      line: trimmed,
      parsedType: parsed.type,
    })
  }

  const stdoutRl = createInterface({ input: child.stdout })
  const stderrRl = createInterface({ input: child.stderr })

  stdoutRl.on('line', line => handleLine(line, 'stdout'))
  stderrRl.on('line', line => handleLine(line, 'stderr'))

  const exitCode = await new Promise<number | null>(resolve => {
    child!.on('close', code => resolve(code))
    child!.on('error', () => resolve(1))
  })

  stdoutRl.close()
  stderrRl.close()

  if (!finalized) {
    const latestTask = getTask(task.id)
    if (latestTask?.status === 'cancelled') {
      finalized = true
      return latestTask
    }
    const errorMessage =
      streamErrorMessage ||
      `Task worker exited with code ${exitCode ?? 1} before producing a final result.`
    task = finalizeTaskFailure(task, errorMessage, 'failed')
  }

  return task
}

export function cancelTask(taskId: string): TaskRecord {
  const task = getTask(taskId)
  if (!task) {
    throw new Error(`Task "${taskId}" not found`)
  }
  if (task.status !== 'running' || !task.pid) {
    return task
  }

  try {
    process.kill(-task.pid, 'SIGTERM')
  } catch {
    try {
      process.kill(task.pid, 'SIGTERM')
    } catch {
      // Ignore; the health normalizer will mark it stale if needed.
    }
  }

  return finalizeTaskFailure(task, 'Task cancelled by user.', 'cancelled')
}

export function reviewTask(
  taskId: string,
  reviewState: TaskReviewState,
): TaskRecord {
  const task = updateTask(taskId, {
    reviewState,
    updatedAt: nowIso(),
  })
  rewriteTaskNoteFrontmatter(task)
  return task
}

export function setTaskPinned(taskId: string, pinned: boolean): TaskRecord {
  const task = updateTask(taskId, {
    pinned,
    updatedAt: nowIso(),
  })
  rewriteTaskNoteFrontmatter(task)
  return task
}

export function archiveTaskContext(taskId: string): TaskRecord {
  const task = getTask(taskId)
  if (!task) {
    throw new Error(`Task "${taskId}" not found`)
  }
  if (task.vaultNotePath && existsSync(task.vaultNotePath)) {
    const archivedPath = join(vaultArchiveDir(), basename(task.vaultNotePath))
    renameSync(task.vaultNotePath, archivedPath)
    return updateTask(taskId, {
      archivedAt: nowIso(),
      vaultNotePath: archivedPath,
      updatedAt: nowIso(),
    })
  }
  return updateTask(taskId, {
    archivedAt: nowIso(),
    updatedAt: nowIso(),
  })
}

export function forgetTaskContext(taskId: string): TaskRecord {
  const task = getTask(taskId)
  if (!task) {
    throw new Error(`Task "${taskId}" not found`)
  }
  if (task.vaultNotePath && existsSync(task.vaultNotePath)) {
    unlinkSync(task.vaultNotePath)
  }
  return updateTask(taskId, {
    vaultNotePath: undefined,
    archivedAt: undefined,
    updatedAt: nowIso(),
  })
}

export function listVaultTasks(options: {
  includeArchived?: boolean
  limit?: number
} = {}): TaskRecord[] {
  return listTasks({
    includeArchived: options.includeArchived,
    limit: options.limit,
  }).filter(task => Boolean(task.vaultNotePath))
}

export function openVaultDirectoryPath(): string {
  ensureTaskDirectories()
  return vaultDir()
}

export function getTaskDetail(taskId: string, options: {
  eventLimit?: number
} = {}): TaskDetail {
  const task = getTask(taskId)
  if (!task) {
    throw new Error(`Task "${taskId}" not found`)
  }

  const detail: TaskDetail = {
    task,
    events: readTaskEvents(task.id, options.eventLimit),
  }

  if (task.artifactPath && existsSync(task.artifactPath)) {
    detail.artifact = readFileSync(task.artifactPath, 'utf-8')
  }

  return detail
}

export function resumeTask(taskId: string): TaskRecord {
  const task = getTask(taskId)
  if (!task) {
    throw new Error(`Task "${taskId}" not found`)
  }
  if (task.status === 'running') {
    return task
  }
  if (task.status === 'queued') {
    return spawnTaskWorker(task.id)
  }

  const restarted = createTask(task.inputPrompt, {
    cwd: task.cwd,
    template: task.template,
    useWorktree: task.useWorktree,
    resumedFromTaskId: task.id,
  })
  return spawnTaskWorker(restarted.id)
}

export function removeTaskWorktree(taskId: string): boolean {
  const task = getTask(taskId)
  if (!task?.worktreePath || !existsSync(task.worktreePath)) {
    return false
  }
  const result = spawnSync('git', ['-C', task.worktreePath, 'worktree', 'remove', '--force', task.worktreePath], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status === 0) {
    return true
  }
  try {
    rmSync(task.worktreePath, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}
