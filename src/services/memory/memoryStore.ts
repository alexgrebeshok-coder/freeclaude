/**
 * FreeClaude v3 — Session Memory Store
 *
 * Lightweight key-value memory persisted to ~/.freeclaude/memory.json.
 * No external dependencies — just JSON file I/O.
 *
 * Override storage location with FREECLAUDE_MEMORY_DIR env var (for testing).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

export const ENV_MEMORY_DIR = 'FREECLAUDE_MEMORY_DIR'
export const ENV_MEMORY_PROJECT = 'FREECLAUDE_MEMORY_PROJECT'

export type MemoryScope = 'global' | 'project'
export type MemoryCategory =
  | 'profile'
  | 'preference'
  | 'decision'
  | 'project'
  | 'note'
  | 'general'

function getMemoryDir(): string {
  if (process.env[ENV_MEMORY_DIR]) {
    return process.env[ENV_MEMORY_DIR]!
  }
  return join(homedir(), '.freeclaude')
}

function getMemoryFile(): string {
  return join(getMemoryDir(), 'memory.json')
}

export type MemoryEntry = {
  key: string
  value: string
  createdAt: string
  updatedAt: string
  tags?: string[]
  scope?: MemoryScope
  projectKey?: string
  category?: MemoryCategory
  expiresAt?: string
}

export type MemoryStore = {
  entries: Record<string, MemoryEntry>
}

function ensureDir(): void {
  if (!existsSync(getMemoryDir())) {
    mkdirSync(getMemoryDir(), { recursive: true })
  }
}

function sanitizeProjectKey(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'default-project'
}

export function resolveMemoryProjectKey(projectPath?: string): string {
  const explicit = process.env[ENV_MEMORY_PROJECT]?.trim()
  if (explicit) {
    return sanitizeProjectKey(explicit)
  }
  return sanitizeProjectKey(resolve(projectPath || process.cwd()))
}

function isExpired(entry: MemoryEntry, now = Date.now()): boolean {
  if (!entry.expiresAt) return false
  const expiresAt = new Date(entry.expiresAt).getTime()
  return Number.isFinite(expiresAt) && expiresAt <= now
}

function getStorageKey(
  key: string,
  scope: MemoryScope,
  projectKey?: string,
): string {
  if (scope === 'project') {
    return `project:${projectKey ?? resolveMemoryProjectKey()}:${key}`
  }
  return `global:${key}`
}

function normalizeMemoryEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    scope: entry.scope === 'project' ? 'project' : 'global',
    category: entry.category ?? 'general',
  }
}

export function loadMemory(): MemoryStore {
  ensureDir()
  if (!existsSync(getMemoryFile())) {
    return { entries: {} }
  }
  try {
    const raw = readFileSync(getMemoryFile(), 'utf-8')
    const parsed = JSON.parse(raw) as MemoryStore
    if (!parsed?.entries || typeof parsed.entries !== 'object') {
      return { entries: {} }
    }
    const normalizedEntries = Object.fromEntries(
      Object.entries(parsed.entries).map(([key, value]) => [
        key,
        normalizeMemoryEntry(value),
      ]),
    )
    return { entries: normalizedEntries }
  } catch {
    return { entries: {} }
  }
}

export function saveMemory(store: MemoryStore): void {
  ensureDir()
  writeFileSync(getMemoryFile(), JSON.stringify(store, null, 2) + '\n')
}

export type RememberOptions = {
  tags?: readonly string[]
  scope?: MemoryScope
  projectKey?: string
  category?: MemoryCategory
  ttlDays?: number
  expiresAt?: string
}

function normalizeRememberOptions(
  tagsOrOptions?: string[] | RememberOptions,
): RememberOptions {
  if (Array.isArray(tagsOrOptions)) {
    return { tags: tagsOrOptions }
  }
  return tagsOrOptions ?? {}
}

export function remember(
  key: string,
  value: string,
  tagsOrOptions?: string[] | RememberOptions,
): MemoryEntry {
  const store = loadMemory()
  const now = new Date().toISOString()
  const options = normalizeRememberOptions(tagsOrOptions)
  const candidateExistingEntries = Object.values(store.entries).filter(
    entry => entry.key === key,
  )
  const fallbackExisting = candidateExistingEntries[0]
  const scope = options.scope ?? fallbackExisting?.scope ?? 'global'
  const projectKey =
    scope === 'project'
      ? options.projectKey ??
        fallbackExisting?.projectKey ??
        resolveMemoryProjectKey()
      : undefined
  const storageKey = getStorageKey(key, scope, projectKey)
  const existing =
    store.entries[storageKey] ??
    candidateExistingEntries.find(entry =>
      entry.key === key &&
      (scope === 'project'
        ? entry.scope === 'project' && entry.projectKey === projectKey
        : entry.scope !== 'project'),
    )
  const expiresAt =
    options.expiresAt ??
    (typeof options.ttlDays === 'number'
      ? new Date(Date.now() + options.ttlDays * 86_400_000).toISOString()
      : existing?.expiresAt)

  const entry: MemoryEntry = {
    key,
    value,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    tags: options.tags ? [...options.tags] : existing?.tags,
    scope,
    projectKey,
    category: options.category ?? existing?.category ?? 'general',
    expiresAt,
  }

  store.entries[storageKey] = entry
  saveMemory(store)
  return entry
}

export function forget(key: string): boolean {
  const store = loadMemory()
  let removed = false
  for (const storageKey of Object.keys(store.entries)) {
    if (store.entries[storageKey]?.key === key || storageKey === key) {
      delete store.entries[storageKey]
      removed = true
    }
  }
  if (!removed) return false
  saveMemory(store)
  return removed
}

export function recall(key: string): MemoryEntry | undefined {
  const store = loadMemory()
  const projectKey = resolveMemoryProjectKey()
  const candidates = Object.values(store.entries)
    .filter(entry => entry.key === key)
    .filter(entry => !isExpired(entry))
    .sort((a, b) => {
      const aScore =
        a.scope === 'project' && a.projectKey === projectKey
          ? 2
          : a.scope === 'global'
            ? 1
            : 0
      const bScore =
        b.scope === 'project' && b.projectKey === projectKey
          ? 2
          : b.scope === 'global'
            ? 1
            : 0
      if (aScore !== bScore) return bScore - aScore
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
  return candidates[0]
}

export function search(query: string): MemoryEntry[] {
  const store = loadMemory()
  const q = query.toLowerCase()
  return Object.values(store.entries).filter(
    e =>
      !isExpired(e) &&
      (e.key.toLowerCase().includes(q) ||
        e.value.toLowerCase().includes(q) ||
        e.tags?.some(t => t.toLowerCase().includes(q)) ||
        e.projectKey?.toLowerCase().includes(q) ||
        e.category?.toLowerCase().includes(q)),
  )
}

export function listAll(): MemoryEntry[] {
  const store = loadMemory()
  return Object.values(store.entries)
    .filter(entry => !isExpired(entry))
    .sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
}

export function clearAll(): number {
  const store = loadMemory()
  const count = Object.keys(store.entries).length
  saveMemory({ entries: {} })
  return count
}

export function listRelevantMemories(options: {
  projectKey?: string
  includeGlobal?: boolean
} = {}): MemoryEntry[] {
  const store = loadMemory()
  const projectKey = options.projectKey ?? resolveMemoryProjectKey()
  return Object.values(store.entries)
    .filter(entry => !isExpired(entry))
    .filter(entry => {
      if (entry.scope === 'project') {
        return entry.projectKey === projectKey
      }
      return options.includeGlobal !== false
    })
    .sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
}

export function pruneExpiredMemories(): number {
  const store = loadMemory()
  let removed = 0
  for (const [key, entry] of Object.entries(store.entries)) {
    if (isExpired(entry)) {
      delete store.entries[key]
      removed += 1
    }
  }
  if (removed > 0) {
    saveMemory(store)
  }
  return removed
}

export function exportMarkdown(): string {
  const entries = listAll()
  if (entries.length === 0) return '# FreeClaude Memory\n\nNo memories stored yet.\n'

  const lines = ['# FreeClaude Memory', `*${entries.length} entries*`, '']

  for (const entry of entries) {
    const tags = entry.tags?.length ? ` \`${entry.tags.join('` `')}\`` : ''
    lines.push(`## ${entry.key}${tags}`)
    lines.push('')
    lines.push(entry.value)
    lines.push('')
    lines.push(`*Updated: ${new Date(entry.updatedAt).toLocaleString()}*`)
    lines.push('')
  }

  return lines.join('\n')
}
