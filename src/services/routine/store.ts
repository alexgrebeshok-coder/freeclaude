import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface RoutineApiTrigger {
  enabled: boolean
  token: string | null
}

export interface RoutineGitHubTrigger {
  event: string | null
  secret: string | null
  filters: Record<string, unknown>
}

export interface RoutineTriggers {
  schedule: string | null
  api: RoutineApiTrigger
  github: RoutineGitHubTrigger
}

export interface RoutineRecord {
  id: string
  name: string
  prompt: string
  provider: string | null
  model: string | null
  triggers: RoutineTriggers
  repos: string[]
  env: Record<string, string>
  connectors: string[]
  maxRunsPerDay: number
  createdAt: string
  updatedAt: string
  lastRun: string | null
  enabled: boolean
}

export interface RoutineRunRecord {
  id: string
  routineId: string
  routineName: string
  trigger: 'manual' | 'schedule' | 'api' | 'github'
  status: 'started' | 'completed' | 'failed'
  createdAt: string
  taskId?: string
  note?: string
}

interface RoutinesFile {
  routines: RoutineRecord[]
}

export interface CreateRoutineInput {
  name: string
  prompt: string
  provider?: string | null
  model?: string | null
  schedule?: string | null
  apiEnabled?: boolean
  apiToken?: string | null
  githubEvent?: string | null
  githubSecret?: string | null
  githubFilters?: Record<string, unknown>
  repos?: string[]
  env?: Record<string, string>
  connectors?: string[]
  maxRunsPerDay?: number
  enabled?: boolean
}

export interface UpdateRoutineInput {
  name?: string
  prompt?: string
  provider?: string | null
  model?: string | null
  schedule?: string | null
  apiEnabled?: boolean
  apiToken?: string | null
  githubEvent?: string | null
  githubSecret?: string | null
  githubFilters?: Record<string, unknown>
  repos?: string[]
  env?: Record<string, string>
  connectors?: string[]
  maxRunsPerDay?: number
  lastRun?: string | null
  enabled?: boolean
}

function nowIso(): string {
  return new Date().toISOString()
}

function freeclaudeHome(): string {
  return process.env.FREECLAUDE_HOME || join(homedir(), '.freeclaude')
}

export function getRoutineConfigPath(): string {
  return join(freeclaudeHome(), 'routines.json')
}

export function getRoutineRunsPath(): string {
  return join(freeclaudeHome(), 'routine-runs')
}

function getRoutineRunsIndexPath(): string {
  return join(getRoutineRunsPath(), 'index.jsonl')
}

function ensureRoutineDirs(): void {
  for (const dir of [freeclaudeHome(), getRoutineRunsPath()]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }
}

function defaultTriggers(): RoutineTriggers {
  return {
    schedule: null,
    api: {
      enabled: false,
      token: null,
    },
    github: {
      event: null,
      secret: null,
      filters: {},
    },
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${label} is required`)
  }
  return trimmed
}

function assertValidCron(schedule: string | null | undefined): string | null {
  if (schedule == null || schedule.trim() === '') return null
  const trimmed = schedule.trim()
  if (trimmed.split(/\s+/).length !== 5) {
    throw new Error('Schedule must be a 5-field cron expression')
  }
  return trimmed
}

function assertValidMaxRunsPerDay(value: number | undefined): number {
  const next = value ?? 5
  if (!Number.isInteger(next) || next <= 0) {
    throw new Error('maxRunsPerDay must be a positive integer')
  }
  return next
}

export function generateRoutineId(): string {
  return `rtn_${randomUUID().replace(/-/g, '').slice(0, 8)}`
}

export function generateRoutineToken(): string {
  return `fc_tok_${randomUUID().replace(/-/g, '').slice(0, 24)}`
}

export function generateRoutineWebhookSecret(): string {
  return `fc_hook_${randomUUID().replace(/-/g, '').slice(0, 24)}`
}

export function loadRoutineFile(): RoutinesFile {
  ensureRoutineDirs()
  const path = getRoutineConfigPath()
  if (!existsSync(path)) {
    return { routines: [] }
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<RoutinesFile>
    return {
      routines: Array.isArray(parsed.routines) ? parsed.routines : [],
    }
  } catch {
    return { routines: [] }
  }
}

export function saveRoutineFile(file: RoutinesFile): void {
  ensureRoutineDirs()
  writeFileSync(
    getRoutineConfigPath(),
    JSON.stringify({ routines: file.routines }, null, 2) + '\n',
    'utf-8',
  )
}

function resolveRoutineIndex(
  routines: RoutineRecord[],
  idOrName: string,
): number {
  const needle = idOrName.trim().toLowerCase()
  if (!needle) {
    throw new Error('Routine id or name is required')
  }

  const exact = routines.findIndex(r => r.id === needle || normalizeName(r.name) === needle)
  if (exact >= 0) return exact

  const matches = routines
    .map((routine, index) => ({ routine, index }))
    .filter(({ routine }) =>
      routine.id.startsWith(needle) || normalizeName(routine.name).includes(needle),
    )

  if (matches.length === 1) {
    return matches[0]!.index
  }
  if (matches.length > 1) {
    throw new Error(`Routine "${idOrName}" is ambiguous`)
  }
  throw new Error(`Routine "${idOrName}" not found`)
}

export function listRoutines(): RoutineRecord[] {
  return loadRoutineFile().routines
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function getRoutine(idOrName: string): RoutineRecord {
  const file = loadRoutineFile()
  return file.routines[resolveRoutineIndex(file.routines, idOrName)]!
}

export function createRoutine(input: CreateRoutineInput): RoutineRecord {
  const file = loadRoutineFile()
  const name = assertNonEmpty(input.name, 'Routine name')
  const prompt = assertNonEmpty(input.prompt, 'Routine prompt')

  if (file.routines.some(r => normalizeName(r.name) === normalizeName(name))) {
    throw new Error(`Routine "${name}" already exists`)
  }

  const createdAt = nowIso()
  const apiEnabled = Boolean(input.apiEnabled || input.apiToken)

  const routine: RoutineRecord = {
    id: generateRoutineId(),
    name,
    prompt,
    provider: input.provider?.trim() || null,
    model: input.model?.trim() || null,
    triggers: {
      schedule: assertValidCron(input.schedule),
      api: {
        enabled: apiEnabled,
        token: apiEnabled ? (input.apiToken?.trim() || generateRoutineToken()) : null,
      },
      github: {
        event: input.githubEvent?.trim() || null,
        secret:
          input.githubEvent?.trim()
            ? (input.githubSecret?.trim() || generateRoutineWebhookSecret())
            : null,
        filters: input.githubFilters ?? {},
      },
    },
    repos: input.repos?.filter(Boolean) ?? [],
    env: input.env ?? {},
    connectors: input.connectors?.filter(Boolean) ?? [],
    maxRunsPerDay: assertValidMaxRunsPerDay(input.maxRunsPerDay),
    createdAt,
    updatedAt: createdAt,
    lastRun: null,
    enabled: input.enabled ?? true,
  }

  file.routines.push(routine)
  saveRoutineFile(file)
  return routine
}

export function updateRoutine(
  idOrName: string,
  patch: UpdateRoutineInput,
): RoutineRecord {
  const file = loadRoutineFile()
  const index = resolveRoutineIndex(file.routines, idOrName)
  const current = file.routines[index]!

  const nextName = patch.name ? assertNonEmpty(patch.name, 'Routine name') : current.name
  if (
    normalizeName(nextName) !== normalizeName(current.name) &&
    file.routines.some((routine, routineIndex) =>
      routineIndex !== index && normalizeName(routine.name) === normalizeName(nextName),
    )
  ) {
    throw new Error(`Routine "${nextName}" already exists`)
  }

  const next: RoutineRecord = {
    ...current,
    ...(patch.name !== undefined ? { name: nextName } : {}),
    ...(patch.prompt !== undefined
      ? { prompt: assertNonEmpty(patch.prompt, 'Routine prompt') }
      : {}),
    ...(patch.provider !== undefined ? { provider: patch.provider?.trim() || null } : {}),
    ...(patch.model !== undefined ? { model: patch.model?.trim() || null } : {}),
    triggers: {
      schedule:
        patch.schedule !== undefined
          ? assertValidCron(patch.schedule)
          : current.triggers.schedule,
      api: {
        enabled: patch.apiEnabled ?? current.triggers.api.enabled,
        token:
          patch.apiEnabled === false
            ? null
            : patch.apiToken !== undefined
              ? patch.apiToken?.trim() || null
              : current.triggers.api.token,
      },
      github: {
        event:
          patch.githubEvent !== undefined
            ? patch.githubEvent?.trim() || null
            : current.triggers.github.event,
        secret:
          patch.githubEvent === null || patch.githubEvent === ''
            ? null
            : patch.githubSecret !== undefined
              ? patch.githubSecret?.trim() || null
              : current.triggers.github.secret,
        filters: patch.githubFilters ?? current.triggers.github.filters,
      },
    },
    ...(patch.repos !== undefined ? { repos: patch.repos.filter(Boolean) } : {}),
    ...(patch.env !== undefined ? { env: patch.env } : {}),
    ...(patch.connectors !== undefined
      ? { connectors: patch.connectors.filter(Boolean) }
      : {}),
    ...(patch.maxRunsPerDay !== undefined
      ? { maxRunsPerDay: assertValidMaxRunsPerDay(patch.maxRunsPerDay) }
      : {}),
    ...(patch.lastRun !== undefined ? { lastRun: patch.lastRun } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    updatedAt: nowIso(),
  }

  if (next.triggers.api.enabled && !next.triggers.api.token) {
    next.triggers.api.token = generateRoutineToken()
  }
  if (next.triggers.github.event && !next.triggers.github.secret) {
    next.triggers.github.secret = generateRoutineWebhookSecret()
  }

  file.routines[index] = next
  saveRoutineFile(file)
  return next
}

export function deleteRoutine(idOrName: string): RoutineRecord {
  const file = loadRoutineFile()
  const index = resolveRoutineIndex(file.routines, idOrName)
  const [removed] = file.routines.splice(index, 1)
  saveRoutineFile(file)
  return removed!
}

export function setRoutineEnabled(
  idOrName: string,
  enabled: boolean,
): RoutineRecord {
  return updateRoutine(idOrName, { enabled })
}

export function buildRoutinePrompt(
  routine: RoutineRecord,
  extraContext?: string,
): string {
  const lines = [
    `Routine: ${routine.name}`,
    ...(routine.repos.length > 0
      ? [`Repositories: ${routine.repos.join(', ')}`]
      : []),
    ...(routine.provider ? [`Provider: ${routine.provider}`] : []),
    ...(routine.model ? [`Model: ${routine.model}`] : []),
    '',
    routine.prompt.trim(),
  ]

  if (extraContext?.trim()) {
    lines.push('', 'Additional context:', extraContext.trim())
  }

  return lines.join('\n')
}

export function recordRoutineRun(
  entry: Omit<RoutineRunRecord, 'id' | 'createdAt'> & {
    createdAt?: string
  },
): RoutineRunRecord {
  ensureRoutineDirs()
  const run: RoutineRunRecord = {
    id: `run_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    createdAt: entry.createdAt ?? nowIso(),
    ...entry,
  }
  appendFileSync(getRoutineRunsIndexPath(), JSON.stringify(run) + '\n', 'utf-8')
  return run
}

export function listRoutineRuns(
  idOrName?: string,
  limit?: number,
): RoutineRunRecord[] {
  ensureRoutineDirs()
  const path = getRoutineRunsIndexPath()
  if (!existsSync(path)) return []

  const routineId = idOrName ? getRoutine(idOrName).id : null

  const records = readFileSync(path, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as RoutineRunRecord
      } catch {
        return null
      }
    })
    .filter((record): record is RoutineRunRecord => record !== null)
    .filter(record => (routineId ? record.routineId === routineId : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return typeof limit === 'number' ? records.slice(0, limit) : records
}
