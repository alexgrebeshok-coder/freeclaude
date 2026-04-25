/**
 * lessons.ts — Append/read compounding lessons in ~/.freeclaude/lessons.json
 *
 * CLI:
 *   bun run scripts/lessons.ts add --project <name> --task <id> --outcome ok|fail|partial --lesson "<text>" [--tags a,b,c]
 *   bun run scripts/lessons.ts list [--project X] [--tags a,b] [--limit N]
 *   bun run scripts/lessons.ts query <free-text> [--limit N]
 *   bun run scripts/lessons.ts export --format json|md
 *   bun run scripts/lessons.ts prune --max N
 *
 * Storage: ~/.freeclaude/lessons.json
 * Override path via FC_LESSONS_PATH env var.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Outcome = 'ok' | 'fail' | 'partial'

export type Lesson = {
  /** Compact unique ID: `${Date.now().toString(36)}-${random}` */
  id: string
  project: string
  task: string
  outcome: Outcome
  /** Free-text lesson, capped at MAX_LESSON_LENGTH chars */
  lesson: string
  tags: string[]
  /** Epoch ms */
  ts: number
}

export type Store = { version: 1; lessons: Lesson[] }

export type AddOpts = {
  project: string
  task: string
  outcome: Outcome
  lesson: string
  tags: string[]
}

export type ListOpts = {
  project?: string
  tags?: string[]
  limit?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LESSON_LENGTH = 2000
const VALID_OUTCOMES: ReadonlyArray<Outcome> = ['ok', 'fail', 'partial']
const DEFAULT_STORE_PATH = join(homedir(), '.freeclaude', 'lessons.json')

// ---------------------------------------------------------------------------
// Core utilities
// ---------------------------------------------------------------------------

/**
 * Generate a compact unique ID based on timestamp + random suffix.
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Load the lesson store from disk. Returns a fresh empty store if the file
 * does not exist yet.
 * @throws if the file exists but cannot be parsed.
 */
export function loadStore(storePath: string): Store {
  if (!existsSync(storePath)) {
    return { version: 1, lessons: [] }
  }
  try {
    const raw = readFileSync(storePath, 'utf8')
    const parsed = JSON.parse(raw) as Store
    if (parsed.version !== 1 || !Array.isArray(parsed.lessons)) {
      throw new Error('Unexpected store format (version or lessons field missing)')
    }
    return parsed
  } catch (err) {
    throw new Error(
      `Failed to read store at ${storePath}: ${(err as Error).message}`,
    )
  }
}

/**
 * Atomically save a store to disk (write tmp → rename).
 * Creates parent directories if needed.
 */
export function saveStore(storePath: string, store: Store): void {
  const dir = dirname(storePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const tmpPath = `${storePath}.${process.pid}.tmp`
  writeFileSync(tmpPath, JSON.stringify(store, null, 2) + '\n', 'utf8')
  renameSync(tmpPath, storePath)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Add a lesson to the store. Validates outcome, trims lesson text to
 * MAX_LESSON_LENGTH and warns to stderr if truncated.
 * Writes atomically. Returns the newly created Lesson.
 */
export function addLesson(storePath: string, opts: AddOpts): Lesson {
  if (!(VALID_OUTCOMES as ReadonlyArray<string>).includes(opts.outcome)) {
    throw new Error(
      `Invalid outcome "${opts.outcome}". Must be one of: ${VALID_OUTCOMES.join(', ')}`,
    )
  }

  let lessonText = opts.lesson
  if (lessonText.length > MAX_LESSON_LENGTH) {
    process.stderr.write(
      `Warning: lesson truncated from ${lessonText.length} to ${MAX_LESSON_LENGTH} chars\n`,
    )
    lessonText = lessonText.slice(0, MAX_LESSON_LENGTH)
  }

  const store = loadStore(storePath)
  const entry: Lesson = {
    id: generateId(),
    project: opts.project,
    task: opts.task,
    outcome: opts.outcome,
    lesson: lessonText,
    tags: opts.tags,
    ts: Date.now(),
  }
  store.lessons.push(entry)
  saveStore(storePath, store)
  return entry
}

/**
 * List lessons newest-first with optional AND-ed filters.
 * Tag filter uses OR within the provided tags (any overlap passes).
 */
export function listLessons(store: Store, opts: ListOpts = {}): Lesson[] {
  let lessons = [...store.lessons].sort((a, b) => b.ts - a.ts)

  if (opts.project !== undefined) {
    lessons = lessons.filter(l => l.project === opts.project)
  }

  if (opts.tags !== undefined && opts.tags.length > 0) {
    const filterTags = opts.tags.map(t => t.toLowerCase())
    lessons = lessons.filter(l =>
      filterTags.some(ft => l.tags.map(t => t.toLowerCase()).includes(ft)),
    )
  }

  if (opts.limit !== undefined && opts.limit > 0) {
    lessons = lessons.slice(0, opts.limit)
  }

  return lessons
}

/**
 * Score a single lesson against a set of query tokens.
 * Scoring weights: lesson-text match +1, tag match +2, project match +1.5.
 */
function scoreLesson(lesson: Lesson, tokens: string[]): number {
  let score = 0
  const lessonLower = lesson.lesson.toLowerCase()
  const tagsLower = lesson.tags.map(t => t.toLowerCase())
  const projectLower = lesson.project.toLowerCase()

  for (const token of tokens) {
    if (lessonLower.includes(token)) score += 1
    if (tagsLower.some(t => t.includes(token))) score += 2
    if (projectLower.includes(token)) score += 1.5
  }

  return score
}

/**
 * Query lessons by free text. Tokenizes the query (lowercase, split on \W+)
 * and scores each lesson. Returns top-K results, newest wins ties.
 */
export function queryLessons(store: Store, query: string, limit = 10): Lesson[] {
  const tokens = query.toLowerCase().split(/\W+/).filter(Boolean)
  if (tokens.length === 0) return []

  const scored = store.lessons
    .map(l => ({ lesson: l, score: scoreLesson(l, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.lesson.ts - a.lesson.ts // newest wins ties
    })

  return scored.slice(0, limit).map(({ lesson }) => lesson)
}

/**
 * Return a new Store keeping only the newest `maxN` lessons, sorted by ts.
 * Does not write to disk — call saveStore() with the result.
 */
export function pruneStore(store: Store, maxN: number): Store {
  const sorted = [...store.lessons].sort((a, b) => b.ts - a.ts)
  return { version: 1, lessons: sorted.slice(0, maxN) }
}

/**
 * Render a lesson list as Markdown. Entries are separated by a blank line.
 */
export function formatMarkdown(lessons: Lesson[]): string {
  if (lessons.length === 0) return '_(no lessons)_'
  return lessons
    .map(l => {
      const header = `## ${l.project} / ${l.task} [${l.outcome}]`
      const body = `- ${l.lesson}`
      const tags = l.tags.length > 0 ? `Tags: ${l.tags.join(', ')}` : 'Tags: (none)'
      return `${header}\n${body}\n${tags}`
    })
    .join('\n\n')
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

/** Extract the value of a --flag from an argv array, or undefined. */
function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1 || idx + 1 >= args.length) return undefined
  return args[idx + 1]
}

/** Exit with code 2 (bad args) and print to stderr. */
function exitBadArgs(msg: string): never {
  process.stderr.write(`Error: ${msg}\n`)
  process.exit(2)
}

/** Exit with code 1 (IO error) and print to stderr. */
function exitIOError(msg: string): never {
  process.stderr.write(`Error: ${msg}\n`)
  process.exit(1)
}

/** Inline a shortened lesson text for display. */
function shortLesson(l: Lesson): string {
  const suffix = l.lesson.length > 80 ? '…' : ''
  return `[${l.id}] ${l.project}/${l.task} (${l.outcome}) — ${l.lesson.slice(0, 80)}${suffix}`
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `
Usage:
  bun run scripts/lessons.ts add --project <name> --task <id> --outcome ok|fail|partial --lesson "<text>" [--tags a,b,c]
  bun run scripts/lessons.ts list [--project X] [--tags a,b] [--limit N]
  bun run scripts/lessons.ts query <free-text> [--limit N]
  bun run scripts/lessons.ts export --format json|md
  bun run scripts/lessons.ts prune --max N

Storage: ~/.freeclaude/lessons.json
Override: FC_LESSONS_PATH=<path>
`.trim()

function main(): void {
  const argv = process.argv.slice(2)
  const [cmd, ...rest] = argv

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(USAGE)
    process.exit(0)
  }

  const storePath: string =
    (process.env['FC_LESSONS_PATH'] ?? '') || DEFAULT_STORE_PATH

  switch (cmd) {
    // -----------------------------------------------------------------------
    case 'add': {
      const project = getFlag(rest, '--project')
      const task = getFlag(rest, '--task')
      const outcome = getFlag(rest, '--outcome')
      const lessonText = getFlag(rest, '--lesson')
      const tagsStr = getFlag(rest, '--tags')

      if (!project) exitBadArgs('--project is required')
      if (!task) exitBadArgs('--task is required')
      if (!outcome) exitBadArgs('--outcome is required')
      if (!lessonText) exitBadArgs('--lesson is required')
      if (!(VALID_OUTCOMES as ReadonlyArray<string>).includes(outcome)) {
        exitBadArgs(`--outcome must be one of: ${VALID_OUTCOMES.join(', ')}`)
      }

      const tags = tagsStr
        ? tagsStr.split(',').map(t => t.trim()).filter(Boolean)
        : []

      try {
        const entry = addLesson(storePath, {
          project,
          task,
          outcome: outcome as Outcome,
          lesson: lessonText,
          tags,
        })
        console.log(`Added lesson ${entry.id}`)
      } catch (err) {
        exitIOError((err as Error).message)
      }
      break
    }

    // -----------------------------------------------------------------------
    case 'list': {
      const project = getFlag(rest, '--project')
      const tagsStr = getFlag(rest, '--tags')
      const limitStr = getFlag(rest, '--limit')
      const tags = tagsStr
        ? tagsStr.split(',').map(t => t.trim()).filter(Boolean)
        : undefined
      const limit = limitStr ? parseInt(limitStr, 10) : undefined

      let store: Store
      try {
        store = loadStore(storePath)
      } catch (err) {
        exitIOError((err as Error).message)
      }

      const lessons = listLessons(store, { project, tags, limit })
      if (lessons.length === 0) {
        console.log('No lessons found.')
        break
      }
      for (const l of lessons) {
        console.log(shortLesson(l))
        if (l.tags.length > 0) console.log(`  tags: ${l.tags.join(', ')}`)
      }
      break
    }

    // -----------------------------------------------------------------------
    case 'query': {
      const queryText = rest.filter(a => !a.startsWith('--')).join(' ')
      const limitStr = getFlag(rest, '--limit')
      const limit = limitStr ? parseInt(limitStr, 10) : 10

      if (!queryText.trim()) exitBadArgs('query text is required')

      let store: Store
      try {
        store = loadStore(storePath)
      } catch (err) {
        exitIOError((err as Error).message)
      }

      const lessons = queryLessons(store, queryText, limit)
      if (lessons.length === 0) {
        console.log('No matching lessons found.')
        break
      }
      for (const l of lessons) {
        console.log(shortLesson(l))
        if (l.tags.length > 0) console.log(`  tags: ${l.tags.join(', ')}`)
      }
      break
    }

    // -----------------------------------------------------------------------
    case 'export': {
      const format = getFlag(rest, '--format') ?? 'json'
      if (format !== 'json' && format !== 'md') {
        exitBadArgs('--format must be "json" or "md"')
      }

      let store: Store
      try {
        store = loadStore(storePath)
      } catch (err) {
        exitIOError((err as Error).message)
      }

      const lessons = [...store.lessons].sort((a, b) => b.ts - a.ts)

      if (format === 'json') {
        console.log(JSON.stringify({ version: 1, lessons }, null, 2))
      } else {
        console.log(formatMarkdown(lessons))
      }
      break
    }

    // -----------------------------------------------------------------------
    case 'prune': {
      const maxStr = getFlag(rest, '--max')
      if (!maxStr) exitBadArgs('--max is required')
      const maxN = parseInt(maxStr, 10)
      if (isNaN(maxN) || maxN < 0) exitBadArgs('--max must be a non-negative integer')

      let store: Store
      try {
        store = loadStore(storePath)
      } catch (err) {
        exitIOError((err as Error).message)
      }

      const originalCount = store.lessons.length
      const pruned = pruneStore(store, maxN)

      try {
        saveStore(storePath, pruned)
      } catch (err) {
        exitIOError((err as Error).message)
      }

      const removed = originalCount - pruned.lessons.length
      console.log(`Pruned ${removed} lesson(s). Kept ${pruned.lessons.length}.`)
      break
    }

    // -----------------------------------------------------------------------
    default:
      exitBadArgs(`Unknown command: "${cmd}". Use --help for usage.`)
  }
}

function isDirectExecution(): boolean {
  const invokedPath = process.argv[1]
  if (!invokedPath) return false
  try {
    return resolve(invokedPath) === resolve(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isDirectExecution()) {
  main()
}
