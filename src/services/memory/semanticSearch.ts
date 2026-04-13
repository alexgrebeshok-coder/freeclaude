/**
 * FreeClaude v3 — Semantic Memory Search
 *
 * Uses Ollama embeddings (nomic-embed-text) for semantic search over memories.
 * Falls back to keyword search if Ollama is unavailable.
 *
 * Storage: ~/.freeclaude/embeddings.json
 * Model: nomic-embed-text (via Ollama)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const EMBEDDINGS_FILE = join(homedir(), '.freeclaude', 'embeddings.json')
const OLLAMA_URL = 'http://localhost:11434'
const EMBED_MODEL = 'nomic-embed-text'

type EmbeddingEntry = {
  key: string
  value: string
  embedding: number[]
  updatedAt: string
}

type EmbeddingsStore = {
  entries: EmbeddingEntry[]
  model: string
}

function ensureDir(): void {
  const dir = join(homedir(), '.freeclaude')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function loadStore(): EmbeddingsStore {
  ensureDir()
  if (!existsSync(EMBEDDINGS_FILE)) return { entries: [], model: EMBED_MODEL }
  try {
    return JSON.parse(readFileSync(EMBEDDINGS_FILE, 'utf-8'))
  } catch {
    return { entries: [], model: EMBED_MODEL }
  }
}

function saveStore(store: EmbeddingsStore): void {
  ensureDir()
  writeFileSync(EMBEDDINGS_FILE, JSON.stringify(store), 'utf-8')
}

async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    })
    if (!resp.ok) return null
    const data = await resp.json() as { embeddings?: number[][] }
    return data.embeddings?.[0] ?? null
  } catch {
    return null
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * Index a memory entry for semantic search.
 * Call this after /remember to keep embeddings in sync.
 */
export async function indexMemory(key: string, value: string): Promise<boolean> {
  const text = `${key}: ${value}`
  const embedding = await getEmbedding(text)
  if (!embedding) return false

  const store = loadStore()
  const existing = store.entries.findIndex(e => e.key === key)
  const entry: EmbeddingEntry = {
    key,
    value,
    embedding,
    updatedAt: new Date().toISOString(),
  }

  if (existing >= 0) {
    store.entries[existing] = entry
  } else {
    store.entries.push(entry)
  }

  saveStore(store)
  return true
}

/**
 * Remove a memory entry from the index.
 */
export async function removeFromIndex(key: string): Promise<void> {
  const store = loadStore()
  store.entries = store.entries.filter(e => e.key !== key)
  saveStore(store)
}

/**
 * Semantic search over all indexed memories.
 * Returns top N results sorted by similarity.
 */
export async function semanticSearch(query: string, topN = 5): Promise<Array<{
  key: string
  value: string
  score: number
}>> {
  const store = loadStore()
  if (store.entries.length === 0) return []

  const queryEmbedding = await getEmbedding(query)
  if (!queryEmbedding) return []

  const scored = store.entries.map(entry => ({
    key: entry.key,
    value: entry.value,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }))

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topN)
}

/**
 * Check if Ollama embedding model is available.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
    if (!resp.ok) return false
    const data = await resp.json() as { models?: Array<{ name: string }> }
    return data.models?.some(m => m.name.includes('nomic')) ?? false
  } catch {
    return false
  }
}

/**
 * Rebuild the entire embedding index from memory.json.
 */
export async function rebuildIndex(): Promise<{ indexed: number; failed: number }> {
  const { listAll } = await import('./memoryStore.js')
  const memories = listAll()
  let indexed = 0, failed = 0

  const store: EmbeddingsStore = { entries: [], model: EMBED_MODEL }

  for (const mem of memories) {
    const text = `${mem.key}: ${mem.value}`
    const embedding = await getEmbedding(text)
    if (embedding) {
      store.entries.push({
        key: mem.key,
        value: mem.value,
        embedding,
        updatedAt: mem.updatedAt,
      })
      indexed++
    } else {
      failed++
    }
  }

  saveStore(store)
  return { indexed, failed }
}
