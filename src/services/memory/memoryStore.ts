/**
 * FreeClaude v3 — Session Memory Store
 *
 * Lightweight key-value memory persisted to ~/.freeclaude/memory.json.
 * No external dependencies — just JSON file I/O.
 *
 * Override storage location with FREECLAUDE_MEMORY_DIR env var (for testing).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const ENV_MEMORY_DIR = 'FREECLAUDE_MEMORY_DIR'

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
}

export type MemoryStore = {
  entries: Record<string, MemoryEntry>
}

function ensureDir(): void {
  if (!existsSync(getMemoryDir())) {
    mkdirSync(getMemoryDir(), { recursive: true })
  }
}

export function loadMemory(): MemoryStore {
  ensureDir()
  if (!existsSync(getMemoryFile())) {
    return { entries: {} }
  }
  try {
    const raw = readFileSync(getMemoryFile(), 'utf-8')
    return JSON.parse(raw) as MemoryStore
  } catch {
    return { entries: {} }
  }
}

export function saveMemory(store: MemoryStore): void {
  ensureDir()
  writeFileSync(getMemoryFile(), JSON.stringify(store, null, 2) + '\n')
}

export function remember(key: string, value: string, tags?: string[]): MemoryEntry {
  const store = loadMemory()
  const now = new Date().toISOString()
  const existing = store.entries[key]

  const entry: MemoryEntry = {
    key,
    value,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    tags: tags ?? existing?.tags,
  }

  store.entries[key] = entry
  saveMemory(store)
  return entry
}

export function forget(key: string): boolean {
  const store = loadMemory()
  if (!(key in store.entries)) return false
  delete store.entries[key]
  saveMemory(store)
  return true
}

export function recall(key: string): MemoryEntry | undefined {
  const store = loadMemory()
  return store.entries[key]
}

export function search(query: string): MemoryEntry[] {
  const store = loadMemory()
  const q = query.toLowerCase()
  return Object.values(store.entries).filter(e =>
    e.key.toLowerCase().includes(q) ||
    e.value.toLowerCase().includes(q) ||
    e.tags?.some(t => t.toLowerCase().includes(q)),
  )
}

export function listAll(): MemoryEntry[] {
  const store = loadMemory()
  return Object.values(store.entries).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

export function clearAll(): number {
  const store = loadMemory()
  const count = Object.keys(store.entries).length
  saveMemory({ entries: {} })
  return count
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
