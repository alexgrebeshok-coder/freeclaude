/**
 * FreeClaude v3 — GBrain Client
 *
 * Wraps GBrain CLI for semantic search and memory retrieval.
 * Used by contextEnricher to add project knowledge to prompts.
 *
 * v3 changes:
 * - Dynamic GBrain binary resolution (not hardcoded)
 * - Checks: PATH, npx, local node_modules, ~/.openclaw/workspace
 * - Caching with TTL
 * - Graceful degradation when unavailable
 */

import { execSync, exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

// ---------------------------------------------------------------------------
// GBrain binary resolution
// ---------------------------------------------------------------------------

/** Cached resolved path (resolved once per process) */
let _resolvedBin: string | null = null

/**
 * Resolve GBrain binary path.
 * Tries multiple locations in order:
 * 1. GBrain env var (explicit override)
 * 2. PATH (global install)
 * 3. npx gbrain (via npm)
 * 4. ~/.openclaw/workspace/node_modules/.bin/gbrain (local install)
 * 5. current working directory node_modules/.bin/gbrain
 */
function resolveGBrainBin(): string | null {
  if (_resolvedBin) return _resolvedBin

  // 1. Explicit env override
  const envBin = process.env.FREECLADE_GBRAIN_BIN
  if (envBin && existsSync(envBin)) {
    _resolvedBin = envBin
    return _resolvedBin
  }

  // 2. Check PATH via `which`
  const pathCandidates = ['gbrain']
  for (const cmd of pathCandidates) {
    try {
      const result = execSync(`which ${cmd} 2>/dev/null`, {
        timeout: 3000,
        encoding: 'utf-8',
      }).trim()
      if (result && existsSync(result)) {
        _resolvedBin = result
        return _resolvedBin
      }
    } catch {
      // not in PATH
    }
  }

  // 3. Check common local install paths
  const localPaths = [
    join(homedir(), '.openclaw/workspace/node_modules/.bin/gbrain'),
    join(process.cwd(), 'node_modules/.bin/gbrain'),
  ]

  for (const p of localPaths) {
    if (existsSync(p)) {
      _resolvedBin = p
      return _resolvedBin
    }
  }

  // 4. Try npx resolution
  try {
    const npxResult = execSync(
      `npm root -g 2>/dev/null`,
      { timeout: 5000, encoding: 'utf-8' },
    ).trim()
    if (npxResult) {
      const npxBin = join(npxResult, 'gbrain/bin/gbrain.js')
      // Try the bin directly
      const candidates = [
        join(npxResult, 'gbrain', 'bin', 'gbrain.js'),
        join(npxResult, '..', 'lib', 'node_modules', 'gbrain', 'bin', 'gbrain.js'),
      ]
      for (const c of candidates) {
        if (existsSync(c)) {
          _resolvedBin = `node ${c}`
          return _resolvedBin
        }
      }
    }
  } catch {
    // npm not available
  }

  // 5. Last resort: try `npx gbrain` as command
  _resolvedBin = 'npx gbrain'
  return _resolvedBin
}

/**
 * Get the GBrain binary path (cached).
 */
export function getGBrainBin(): string | null {
  return resolveGBrainBin()
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GBrainResult {
  content: string
  score: number
  source: string
}

export interface GBrainSearchOptions {
  topK?: number       // max results (default: 5)
  threshold?: number  // min relevance score (default: 0.5)
  mode?: string       // 'hybrid' | 'semantic' | 'keyword' (default: 'hybrid')
}

const GBRAIN_CACHE = new Map<string, { results: GBrainResult[]; at: number }>()
const GBRAIN_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

export function isGBrainAvailable(): boolean {
  const bin = resolveGBrainBin()
  if (!bin) return false

  try {
    // For "npx gbrain" we just check if npx exists
    if (bin.startsWith('npx ')) {
      try {
        execSync('which npx 2>/dev/null', { timeout: 3000, stdio: 'pipe' })
        return true
      } catch {
        return false
      }
    }

    // For "node /path/to/script.js" check the script
    if (bin.startsWith('node ')) {
      const scriptPath = bin.slice(5)
      return existsSync(scriptPath)
    }

    execSync(`"${bin}" --version`, { timeout: 5000, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search GBrain for relevant context.
 */
export async function searchGBrain(
  query: string,
  options: GBrainSearchOptions = {},
): Promise<GBrainResult[]> {
  const {
    topK = 5,
    threshold = 0.5,
    mode = 'hybrid',
  } = options

  // Check cache
  const cacheKey = `${query}:${topK}:${mode}`
  const cached = GBRAIN_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.at < GBRAIN_CACHE_TTL) {
    return cached.results.filter(r => r.score >= threshold)
  }

  if (!isGBrainAvailable()) {
    return []
  }

  const bin = resolveGBrainBin()!

  try {
    const results = await new Promise<GBrainResult[]>((resolve, reject) => {
      const cmd = bin.startsWith('npx ')
        ? `${bin} search "${query}" --top-k ${topK} --mode ${mode}`
        : `"${bin}" search "${query}" --top-k ${topK} --mode ${mode}`

      exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error) {
          resolve([]) // GBrain errors are non-critical
          return
        }

        try {
          const text = stdout.trim()
          const items: GBrainResult[] = []

          // GBrain outputs: [score] source -- content
          for (const line of text.split('\n')) {
            const match = line.match(/^\[([\d.]+)\]\s+(\S+)\s+--\s+(.+)$/)
            if (match) {
              items.push({
                score: parseFloat(match[1]),
                source: match[2],
                content: match[3].trim(),
              })
            }
          }

          resolve(items.filter(r => r.score >= threshold))
        } catch {
          resolve([])
        }
      })
    })

    // Update cache
    GBRAIN_CACHE.set(cacheKey, { results, at: Date.now() })

    return results
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Import content into GBrain.
 */
export async function importToGBrain(filePath: string): Promise<boolean> {
  if (!isGBrainAvailable()) return false

  const bin = resolveGBrainBin()!

  try {
    await new Promise<boolean>((resolve) => {
      const cmd = bin.startsWith('npx ')
        ? `${bin} import "${filePath}"`
        : `"${bin}" import "${filePath}"`

      exec(cmd, { timeout: 60000 }, (error) => resolve(!error))
    })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Clear GBrain cache.
 */
export function clearCache(): void {
  GBRAIN_CACHE.clear()
}

/**
 * Reset resolved binary (for testing).
 */
export function _resetBin(): void {
  _resolvedBin = null
}
