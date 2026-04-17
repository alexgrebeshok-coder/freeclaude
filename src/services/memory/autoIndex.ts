/**
 * FreeClaude v3 — Auto-Index for GBrain
 *
 * Scans vault/ and daily/ directories, imports new/changed files into GBrain.
 * Tracks indexed files to avoid re-indexing unchanged content.
 *
 * Index state stored at ~/.freeclaude/gbrain-index.json
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { importToGBrain, isGBrainAvailable } from './gbrainClient.js'

const INDEX_STATE_FILE = join(homedir(), '.freeclaude', 'gbrain-index.json')

interface IndexState {
  files: Record<string, {
    path: string
    mtimeMs: number
    indexedAt: string
    size: number
  }>
  lastFullScan: string
}

function loadIndexState(): IndexState {
  try {
    if (existsSync(INDEX_STATE_FILE)) {
      return JSON.parse(readFileSync(INDEX_STATE_FILE, 'utf-8'))
    }
  } catch {
    // Corrupted state — start fresh
  }
  return { files: {}, lastFullScan: '' }
}

function saveIndexState(state: IndexState): void {
  const dir = join(homedir(), '.freeclaude')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(INDEX_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

/**
 * Collect all .md files from a directory recursively.
 */
function collectMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...collectMarkdownFiles(fullPath))
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath)
      }
    }
    return files
  } catch {
    return []
  }
}

/**
 * Check if a file needs re-indexing.
 */
function needsIndexing(filePath: string, state: IndexState): boolean {
  const existing = state.files[filePath]
  if (!existing) return true

  try {
    const stat = statSync(filePath)
    return stat.mtimeMs > existing.mtimeMs || stat.size !== existing.size
  } catch {
    return false // File no longer exists
  }
}

/**
 * Index all vault and daily notes into GBrain.
 * Returns summary of what was indexed.
 */
export async function autoIndexAll(options: {
  force?: boolean
  dryRun?: boolean
} = {}): Promise<{
  indexed: number
  skipped: number
  failed: number
  files: string[]
}> {
  if (!isGBrainAvailable()) {
    return { indexed: 0, skipped: 0, failed: 0, files: [] }
  }

  const state = loadIndexState()
  const freeclaudeHome = join(homedir(), '.freeclaude')

  // Collect files from all vault subdirectories and daily
  const dirs = [
    join(freeclaudeHome, 'vault', 'tasks'),
    join(freeclaudeHome, 'vault', 'projects'),
    join(freeclaudeHome, 'vault', 'notes'),
    join(freeclaudeHome, 'vault'),  // root-level vault notes
    join(freeclaudeHome, 'daily'),
  ]

  const allFiles: string[] = []
  for (const dir of dirs) {
    allFiles.push(...collectMarkdownFiles(dir))
  }

  // Deduplicate
  const uniqueFiles = [...new Set(allFiles)]

  let indexed = 0, skipped = 0, failed = 0
  const indexedFiles: string[] = []

  for (const filePath of uniqueFiles) {
    if (!options.force && !needsIndexing(filePath, state)) {
      skipped++
      continue
    }

    if (options.dryRun) {
      indexed++
      indexedFiles.push(filePath)
      continue
    }

    const success = await importToGBrain(filePath)
    if (success) {
      try {
        const stat = statSync(filePath)
        state.files[filePath] = {
          path: filePath,
          mtimeMs: stat.mtimeMs,
          indexedAt: new Date().toISOString(),
          size: stat.size,
        }
      } catch {
        // File disappeared during indexing — skip
      }
      indexed++
      indexedFiles.push(filePath)
    } else {
      failed++
    }
  }

  // Clean up stale entries (files that no longer exist)
  for (const path of Object.keys(state.files)) {
    if (!existsSync(path)) {
      delete state.files[path]
    }
  }

  state.lastFullScan = new Date().toISOString()
  if (!options.dryRun) {
    saveIndexState(state)
  }

  return { indexed, skipped, failed, files: indexedFiles }
}

/**
 * Index a single file into GBrain.
 * Used when a new vault note or daily note is created.
 */
export async function indexSingleFile(filePath: string): Promise<boolean> {
  if (!isGBrainAvailable()) return false
  if (!existsSync(filePath)) return false

  const success = await importToGBrain(filePath)
  if (success) {
    const state = loadIndexState()
    try {
      const stat = statSync(filePath)
      state.files[filePath] = {
        path: filePath,
        mtimeMs: stat.mtimeMs,
        indexedAt: new Date().toISOString(),
        size: stat.size,
      }
      saveIndexState(state)
    } catch {
      // Best effort
    }
  }
  return success
}

/**
 * Get index stats for display.
 */
export function getIndexStats(): {
  totalIndexed: number
  lastFullScan: string
  oldestEntry: string
  newestEntry: string
} {
  const state = loadIndexState()
  const entries = Object.values(state.files)

  if (entries.length === 0) {
    return {
      totalIndexed: 0,
      lastFullScan: state.lastFullScan || 'never',
      oldestEntry: 'n/a',
      newestEntry: 'n/a',
    }
  }

  const sorted = entries.sort((a, b) =>
    new Date(a.indexedAt).getTime() - new Date(b.indexedAt).getTime(),
  )

  return {
    totalIndexed: entries.length,
    lastFullScan: state.lastFullScan || 'never',
    oldestEntry: sorted[0]!.indexedAt,
    newestEntry: sorted[sorted.length - 1]!.indexedAt,
  }
}
