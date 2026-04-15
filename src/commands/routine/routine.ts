import { parse as parseShellArgs } from 'shell-quote'

import {
  getTask,
} from '../../services/tasks/taskManager.js'
import {
  createRoutine,
  deleteRoutine,
  getRoutine,
  getRoutineRun,
  listRoutineRuns,
  setRoutineEnabled,
  listRoutines,
  updateRoutine,
} from '../../services/routine/store.js'
import {
  ROUTINE_API_DEFAULT_HOST,
  ROUTINE_API_DEFAULT_PORT,
  getRoutineApiServerStatus,
  startRoutineApiServer,
  stopRoutineApiServer,
} from '../../services/routine/apiServer.js'
import { startRoutineRun } from '../../services/routine/runner.js'
import type { TaskRecord, TaskStatus } from '../../services/tasks/taskManager.js'
import type { RoutineRunRecord } from '../../services/routine/store.js'

type TextResult = { type: 'text'; value: string }

function toText(value: string): TextResult {
  return { type: 'text', value }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function tokenize(args: string): string[] {
  return parseShellArgs(args)
    .filter(token => typeof token === 'string')
    .map(token => String(token))
}

function parseTokens(tokens: string[]): {
  positional: string[]
  flags: Map<string, string[]>
} {
  const positional: string[] = []
  const flags = new Map<string, string[]>()

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }

    const name = token.slice(2)
    const next = tokens[i + 1]
    if (!next || next.startsWith('--')) {
      flags.set(name, [...(flags.get(name) ?? []), 'true'])
      continue
    }

    flags.set(name, [...(flags.get(name) ?? []), next])
    i += 1
  }

  return { positional, flags }
}

function flag(flags: Map<string, string[]>, name: string): string | undefined {
  return flags.get(name)?.at(-1)
}

function flagAll(flags: Map<string, string[]>, name: string): string[] {
  return flags.get(name) ?? []
}

function boolFlag(flags: Map<string, string[]>, name: string): boolean {
  return flags.has(name)
}

function parseEnvFlags(values: string[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const value of values) {
    const [key, ...rest] = value.split('=')
    if (!key || rest.length === 0) continue
    env[key] = rest.join('=')
  }
  return env
}

function parsePositiveInteger(
  value: string | undefined,
  label: string,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }

  return parsed
}

type RoutineRunDisplayStatus = RoutineRunRecord['status'] | TaskStatus

const ROUTINE_LOG_STATUS_FILTERS = new Set<RoutineRunDisplayStatus>([
  'queued',
  'running',
  'started',
  'completed',
  'failed',
  'cancelled',
])

interface RoutineRunSnapshot {
  run: RoutineRunRecord
  task: TaskRecord | null
  status: RoutineRunDisplayStatus
}

function normalizeRoutineRunStatus(
  value: string | undefined,
): RoutineRunDisplayStatus | undefined {
  if (!value) {
    return undefined
  }
  const normalized = value.trim().toLowerCase() as RoutineRunDisplayStatus
  if (!ROUTINE_LOG_STATUS_FILTERS.has(normalized)) {
    throw new Error(
      'Status must be one of: queued, running, started, completed, failed, cancelled',
    )
  }
  return normalized
}

function buildRoutineRunSnapshot(run: RoutineRunRecord): RoutineRunSnapshot {
  const task = run.taskId ? getTask(run.taskId) : null
  return {
    run,
    task,
    status: task?.status ?? run.status,
  }
}

function statusIcon(status: RoutineRunDisplayStatus): string {
  switch (status) {
    case 'completed':
      return '✅'
    case 'failed':
      return '❌'
    case 'cancelled':
      return '⛔'
    case 'queued':
      return '🕓'
    case 'running':
    case 'started':
      return '🚧'
    default:
      return '•'
  }
}

function compactText(value: string | undefined, maxLength = 100): string | undefined {
  if (!value?.trim()) {
    return undefined
  }

  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > maxLength
    ? `${compact.slice(0, Math.max(0, maxLength - 3))}...`
    : compact
}

function formatProviderModel(snapshot: RoutineRunSnapshot): string | null {
  const provider = snapshot.task?.provider ?? snapshot.run.provider ?? null
  const model = snapshot.task?.model ?? snapshot.run.model ?? null

  if (!provider && !model) {
    return null
  }

  return [provider ?? '(default)', model ?? '(default)'].join(' / ')
}

function formatRoutineRunList(
  snapshots: RoutineRunSnapshot[],
  options: {
    routineIdOrName?: string
    limit: number
    status?: RoutineRunDisplayStatus
  },
): string {
  const headerBits = [`${snapshots.length} shown`]
  if (options.routineIdOrName) {
    headerBits.push(`routine: ${options.routineIdOrName}`)
  }
  if (options.status) {
    headerBits.push(`status: ${options.status}`)
  }
  headerBits.push(`last ${options.limit}`)

  const lines = [`📜 Routine runs (${headerBits.join(', ')})`, '']

  for (const snapshot of snapshots) {
    const providerModel = formatProviderModel(snapshot)
    lines.push(
      `  ${statusIcon(snapshot.status)} ${snapshot.run.id}  ${snapshot.run.routineName}  ${snapshot.run.trigger}  ${snapshot.status}  ${snapshot.run.createdAt}`,
    )
    const detailBits = [
      snapshot.run.taskShortId ? `task: ${snapshot.run.taskShortId}` : null,
      providerModel ? `model: ${providerModel}` : null,
    ].filter(Boolean)
    if (detailBits.length > 0) {
      lines.push(`     ${detailBits.join('  ')}`)
    }

    const summary =
      compactText(snapshot.task?.summary ?? snapshot.task?.resultPreview) ??
      compactText(snapshot.run.note)
    if (summary) {
      lines.push(`     ${summary}`)
    }

    const error = compactText(snapshot.task?.errorMessage)
    if (error) {
      lines.push(`     error: ${error}`)
    }
  }

  return lines.join('\n')
}

function formatRoutineRunDetail(snapshot: RoutineRunSnapshot): string {
  const providerModel = formatProviderModel(snapshot)
  const lines = [
    `📘 Routine run ${snapshot.run.id}`,
    `   Routine: ${snapshot.run.routineName} (${snapshot.run.routineId})`,
    `   Trigger: ${snapshot.run.trigger}`,
    `   Status: ${snapshot.status}`,
    `   Recorded status: ${snapshot.run.status}`,
    `   Created: ${snapshot.run.createdAt}`,
    ...(snapshot.run.taskShortId ? [`   Task: ${snapshot.run.taskShortId}`] : []),
    ...(snapshot.run.taskId ? [`   Task ID: ${snapshot.run.taskId}`] : []),
    ...(providerModel ? [`   Model: ${providerModel}`] : []),
    ...(snapshot.task?.updatedAt ? [`   Updated: ${snapshot.task.updatedAt}`] : []),
    ...(snapshot.task?.completedAt ? [`   Completed: ${snapshot.task.completedAt}`] : []),
    ...(typeof snapshot.task?.totalCostUsd === 'number'
      ? [`   Cost: $${snapshot.task.totalCostUsd.toFixed(4)}`]
      : []),
    ...(snapshot.task?.artifactPath ? [`   Artifact: ${snapshot.task.artifactPath}`] : []),
    ...(snapshot.task?.diffPath ? [`   Diff: ${snapshot.task.diffPath}`] : []),
    ...(snapshot.task?.vaultNotePath ? [`   Vault note: ${snapshot.task.vaultNotePath}`] : []),
  ]

  if (snapshot.run.note) {
    lines.push('', 'Note:', snapshot.run.note)
  }
  if (snapshot.task?.summary) {
    lines.push('', 'Summary:', snapshot.task.summary)
  }
  if (snapshot.task?.resultPreview && snapshot.task.resultPreview !== snapshot.task.summary) {
    lines.push('', 'Preview:', snapshot.task.resultPreview)
  }
  if (snapshot.task?.errorMessage) {
    lines.push('', 'Error:', snapshot.task.errorMessage)
  }

  return lines.join('\n')
}

function formatRoutineSummary(): string {
  return [
    'Usage: /routine <subcommand> [args]',
    '',
    'Subcommands:',
    '  list                              — List all routines',
     '  show <id|name>                    — Show one routine in detail',
     '  create <name> --prompt "<text>"   — Create a routine',
     '     [--schedule "<cron>"] [--provider zai] [--model glm-5]',
     '     [--repo owner/repo] [--api] [--api-token <token>]',
     '     [--github-event pull_request] [--github-secret <secret>]',
     '     [--max-runs-per-day 5]',
     '  update <id|name> [flags...]       — Update an existing routine',
     '  run <id|name> [--context "<text>"] — Run routine manually now',
     '  delete <id|name>                  — Delete a routine',
      '  logs [id|name] [--last 20]        — Show recent routine runs',
      '     [--failed] [--status running] [--run <run-id>]',
      '  enable <id|name>                  — Enable triggers',
      '  disable <id|name>                 — Disable triggers',
     `  api start [--host ${ROUTINE_API_DEFAULT_HOST}] [--port ${ROUTINE_API_DEFAULT_PORT}]`,
     '                                   — Start local routine API server',
     '  api stop                          — Stop the local routine API server',
     '  api status                        — Show API server status',
   ].join('\n')
}

function formatRoutine(routine: ReturnType<typeof getRoutine>): string {
  return [
    `🧭 Routine ${routine.id}`,
    `   Name: ${routine.name}`,
    `   Enabled: ${routine.enabled ? 'yes' : 'no'}`,
    `   Schedule: ${routine.triggers.schedule ?? '(manual only)'}`,
    `   Provider: ${routine.provider ?? '(default)'}`,
    `   Model: ${routine.model ?? '(default)'}`,
    `   API: ${routine.triggers.api.enabled ? 'enabled' : 'disabled'}`,
    ...(routine.triggers.api.token
      ? [`   API token: ${routine.triggers.api.token}`]
      : []),
    `   GitHub: ${routine.triggers.github.event ?? '(disabled)'}`,
    ...(routine.triggers.github.secret
      ? [`   GitHub secret: ${routine.triggers.github.secret}`]
      : []),
    `   Repos: ${routine.repos.length > 0 ? routine.repos.join(', ') : '(none)'}`,
    `   Max runs/day: ${routine.maxRunsPerDay}`,
    `   Last run: ${routine.lastRun ?? '(never)'}`,
    '',
    'Prompt:',
    routine.prompt,
  ].join('\n')
}

function handleList(): TextResult {
  const routines = listRoutines()
  if (routines.length === 0) {
    return toText(
      'No routines yet.\n\nUse /routine create "<name>" --prompt "<text>" to create the first one.',
    )
  }

  const lines = [`🧭 Routines (${routines.length})`, '']
  for (const routine of routines) {
    lines.push(
      `  ${routine.enabled ? '✅' : '⏸️'} ${routine.id}  ${routine.name}  ${routine.triggers.schedule ?? 'manual'}`
    )
  }
  lines.push('', 'Use /routine show <id> for details.')
  return toText(lines.join('\n'))
}

function handleShow(idOrName: string): TextResult {
  if (!idOrName) return toText('Usage: /routine show <id|name>')
  return toText(formatRoutine(getRoutine(idOrName)))
}

function handleCreate(tokens: string[]): TextResult {
  const { positional, flags } = parseTokens(tokens)
  const name = positional[0]
  const prompt = flag(flags, 'prompt')

  if (!name || !prompt) {
    return toText(
      'Usage: /routine create <name> --prompt "<text>" [--schedule "<cron>"] [--provider <name>] [--model <name>]',
    )
  }

  const routine = createRoutine({
    name,
    prompt,
    schedule: flag(flags, 'schedule'),
    provider: flag(flags, 'provider'),
    model: flag(flags, 'model'),
    repos: flagAll(flags, 'repo'),
    env: parseEnvFlags(flagAll(flags, 'env')),
    connectors: flagAll(flags, 'connector'),
    apiEnabled: boolFlag(flags, 'api') || flags.has('api-token'),
    apiToken: flag(flags, 'api-token') ?? null,
    githubEvent: flag(flags, 'github-event') ?? null,
    githubSecret: flag(flags, 'github-secret') ?? null,
    maxRunsPerDay: flag(flags, 'max-runs-per-day')
      ? Number(flag(flags, 'max-runs-per-day'))
      : undefined,
    enabled: !boolFlag(flags, 'disabled'),
  })

  const lines = [
    `✅ Created routine: ${routine.id}`,
    `   Name: ${routine.name}`,
    `   Schedule: ${routine.triggers.schedule ?? '(manual only)'}`,
    `   API: ${routine.triggers.api.enabled ? 'enabled' : 'disabled'}`,
  ]
  if (routine.triggers.api.token) {
    lines.push(`   API token: ${routine.triggers.api.token}`)
  }
  if (routine.triggers.github.secret) {
    lines.push(`   GitHub secret: ${routine.triggers.github.secret}`)
  }
  return toText(lines.join('\n'))
}

function handleUpdate(tokens: string[]): TextResult {
  const { positional, flags } = parseTokens(tokens)
  const idOrName = positional[0]
  if (!idOrName) return toText('Usage: /routine update <id|name> [flags]')

  const nextSchedule = flag(flags, 'schedule')
  const nextGithubEvent = flag(flags, 'github-event')

  const routine = updateRoutine(idOrName, {
    ...(flag(flags, 'name') !== undefined ? { name: flag(flags, 'name')! } : {}),
    ...(flag(flags, 'prompt') !== undefined ? { prompt: flag(flags, 'prompt')! } : {}),
    ...(nextSchedule !== undefined
      ? { schedule: nextSchedule === 'off' ? null : nextSchedule }
      : {}),
    ...(flag(flags, 'provider') !== undefined
      ? { provider: flag(flags, 'provider') ?? null }
      : {}),
    ...(flag(flags, 'model') !== undefined ? { model: flag(flags, 'model') ?? null } : {}),
    ...(flags.has('repo') ? { repos: flagAll(flags, 'repo') } : {}),
    ...(flags.has('env') ? { env: parseEnvFlags(flagAll(flags, 'env')) } : {}),
    ...(flags.has('connector') ? { connectors: flagAll(flags, 'connector') } : {}),
    ...(flags.has('api') || flags.has('api-token')
      ? {
          apiEnabled: true,
          apiToken: flag(flags, 'api-token') ?? undefined,
        }
      : {}),
    ...(boolFlag(flags, 'disable-api') ? { apiEnabled: false, apiToken: null } : {}),
    ...(nextGithubEvent !== undefined
      ? { githubEvent: nextGithubEvent === 'off' ? null : nextGithubEvent }
      : {}),
    ...(flag(flags, 'github-secret') !== undefined
      ? { githubSecret: flag(flags, 'github-secret') ?? null }
      : {}),
    ...(flag(flags, 'max-runs-per-day') !== undefined
      ? { maxRunsPerDay: Number(flag(flags, 'max-runs-per-day')) }
      : {}),
    ...(boolFlag(flags, 'enable') ? { enabled: true } : {}),
    ...(boolFlag(flags, 'disable') ? { enabled: false } : {}),
  })

  return toText(`✅ Updated routine: ${routine.id}\n\n${formatRoutine(routine)}`)
}

function handleRun(tokens: string[]): TextResult {
  const { positional, flags } = parseTokens(tokens)
  const idOrName = positional[0]
  if (!idOrName) return toText('Usage: /routine run <id|name> [--context "<text>"]')

  try {
    const started = startRoutineRun({
      routineIdOrName: idOrName,
      trigger: 'manual',
      extraContext: flag(flags, 'context'),
    })

    return toText(
      [
        `🚀 Routine started: ${started.routine.name}`,
        `   Routine ID: ${started.routine.id}`,
        `   Run ID: ${started.run.id}`,
        `   Task ID: ${started.taskShortId}`,
        '',
        `   Use /task ${started.taskShortId} or /vault to inspect outputs when it finishes.`,
      ].join('\n'),
    )
  } catch (error) {
    return toText(`Routine run failed: ${toErrorMessage(error)}`)
  }
}

function handleDelete(idOrName: string): TextResult {
  if (!idOrName) return toText('Usage: /routine delete <id|name>')
  const removed = deleteRoutine(idOrName)
  return toText(`🗑️ Deleted routine: ${removed.id} (${removed.name})`)
}

function handleLogs(tokens: string[]): TextResult {
  const { positional, flags } = parseTokens(tokens)
  const idOrName = positional.join(' ') || undefined
  const runId = flag(flags, 'run')
  const status = boolFlag(flags, 'failed')
    ? 'failed'
    : normalizeRoutineRunStatus(flag(flags, 'status'))
  const limit = parsePositiveInteger(flag(flags, 'last'), '--last', 20)

  if (runId) {
    const run = getRoutineRun(runId)
    if (idOrName && run.routineId !== getRoutine(idOrName).id) {
      throw new Error(`Routine run "${runId}" does not belong to "${idOrName}"`)
    }
    return toText(formatRoutineRunDetail(buildRoutineRunSnapshot(run)))
  }

  const snapshots = listRoutineRuns(idOrName)
    .map(buildRoutineRunSnapshot)
    .filter(snapshot => (status ? snapshot.status === status : true))
    .slice(0, limit)

  if (snapshots.length === 0) {
    const qualifier = [
      status ? `${status} ` : '',
      idOrName ? `for "${idOrName}" ` : '',
    ]
      .join('')
      .trim()
    return toText(qualifier ? `No ${qualifier} routine runs found.` : 'No routine runs yet.')
  }

  return toText(
    formatRoutineRunList(snapshots, {
      routineIdOrName: idOrName,
      limit,
      status,
    }),
  )
}

function handleToggle(idOrName: string, enabled: boolean): TextResult {
  if (!idOrName) {
    return toText(`Usage: /routine ${enabled ? 'enable' : 'disable'} <id|name>`)
  }
  const routine = setRoutineEnabled(idOrName, enabled)
  return toText(
    `${enabled ? '✅ Enabled' : '⏸️ Disabled'} routine: ${routine.id} (${routine.name})`,
  )
}

async function handleApi(tokens: string[]): Promise<TextResult> {
  const { positional, flags } = parseTokens(tokens)
  const action = positional[0] ?? 'status'

  switch (action) {
    case 'start': {
      const status = await startRoutineApiServer({
        host: flag(flags, 'host') ?? ROUTINE_API_DEFAULT_HOST,
        port: flag(flags, 'port') ? Number(flag(flags, 'port')) : ROUTINE_API_DEFAULT_PORT,
      })
      return toText(
        [
          '✅ Routine API server is running',
          `   URL: ${status.url}`,
          `   Health: ${status.url}/health`,
          '',
          'Use the routine API token from /routine show <id> in the Authorization header.',
        ].join('\n'),
      )
    }
    case 'stop': {
      const stopped = await stopRoutineApiServer()
      return toText(stopped ? '🛑 Routine API server stopped.' : 'Routine API server is not running.')
    }
    case 'status': {
      const status = getRoutineApiServerStatus()
      if (!status.running) {
        return toText('Routine API server is not running.')
      }
      return toText(
        [
          '🛰️ Routine API server',
          `   URL: ${status.url}`,
          `   Host: ${status.host}`,
          `   Port: ${status.port}`,
        ].join('\n'),
      )
    }
    default:
      return toText('Usage: /routine api <start|stop|status> [--host 127.0.0.1] [--port 8787]')
  }
}

export async function call(args: string): Promise<TextResult> {
  const tokens = tokenize(args)
  const [subcommand, ...rest] = tokens

  if (!subcommand || subcommand === 'help') {
    return toText(formatRoutineSummary())
  }

  switch (subcommand) {
    case 'list':
      return handleList()
    case 'show':
      return handleShow(rest.join(' '))
    case 'create':
      return handleCreate(rest)
    case 'update':
      return handleUpdate(rest)
    case 'run':
      return handleRun(rest)
    case 'delete':
    case 'remove':
      return handleDelete(rest.join(' '))
    case 'logs':
      return handleLogs(rest)
    case 'enable':
      return handleToggle(rest.join(' '), true)
    case 'disable':
      return handleToggle(rest.join(' '), false)
    case 'api':
      return handleApi(rest)
    default:
      return toText(formatRoutineSummary())
  }
}
