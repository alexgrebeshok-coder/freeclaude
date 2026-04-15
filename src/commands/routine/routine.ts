import { parse as parseShellArgs } from 'shell-quote'

import {
  createTask,
  getTask,
  spawnTaskWorker,
} from '../../services/tasks/taskManager.js'
import {
  buildRoutinePrompt,
  createRoutine,
  deleteRoutine,
  getRoutine,
  listRoutineRuns,
  listRoutines,
  recordRoutineRun,
  setRoutineEnabled,
  updateRoutine,
} from '../../services/routine/store.js'

type TextResult = { type: 'text'; value: string }

function toText(value: string): TextResult {
  return { type: 'text', value }
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
    '     [--github-event pull_request.opened] [--max-runs-per-day 5]',
    '  update <id|name> [flags...]       — Update an existing routine',
    '  run <id|name> [--context "<text>"] — Run routine manually now',
    '  delete <id|name>                  — Delete a routine',
    '  logs [id|name]                    — Show recent routine runs',
    '  enable <id|name>                  — Enable triggers',
    '  disable <id|name>                 — Disable triggers',
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
    `   GitHub: ${routine.triggers.github.event ?? '(disabled)'}`,
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

  const routine = getRoutine(idOrName)
  const prompt = buildRoutinePrompt(routine, flag(flags, 'context'))
  const task = createTask(prompt, {
    cwd: process.cwd(),
    template: 'custom',
    useWorktree: true,
  })
  const spawned = spawnTaskWorker(task.id)
  const run = recordRoutineRun({
    routineId: routine.id,
    routineName: routine.name,
    trigger: 'manual',
    status: 'started',
    taskId: spawned.id,
    note: flag(flags, 'context'),
  })
  updateRoutine(routine.id, { lastRun: run.createdAt })

  return toText(
    [
      `🚀 Routine started: ${routine.name}`,
      `   Routine ID: ${routine.id}`,
      `   Run ID: ${run.id}`,
      `   Task ID: ${spawned.shortId}`,
      '',
      `   Use /task ${spawned.shortId} or /vault to inspect outputs when it finishes.`,
    ].join('\n'),
  )
}

function handleDelete(idOrName: string): TextResult {
  if (!idOrName) return toText('Usage: /routine delete <id|name>')
  const removed = deleteRoutine(idOrName)
  return toText(`🗑️ Deleted routine: ${removed.id} (${removed.name})`)
}

function handleLogs(idOrName?: string): TextResult {
  const runs = listRoutineRuns(idOrName, 20)
  if (runs.length === 0) {
    return toText('No routine runs yet.')
  }

  const lines = [`📜 Routine runs (${runs.length})`, '']
  for (const run of runs) {
    const taskStatus = run.taskId ? getTask(run.taskId)?.status : undefined
    lines.push(
      `  ${run.id}  ${run.routineName}  ${run.trigger}  ${taskStatus ?? run.status}  ${run.createdAt}`,
    )
  }
  return toText(lines.join('\n'))
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
      return handleLogs(rest.join(' ') || undefined)
    case 'enable':
      return handleToggle(rest.join(' '), true)
    case 'disable':
      return handleToggle(rest.join(' '), false)
    default:
      return toText(formatRoutineSummary())
  }
}
