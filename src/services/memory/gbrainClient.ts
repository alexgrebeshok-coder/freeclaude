/**
 * FreeClaude v2 — GBrain Client
 *
 * Wraps GBrain CLI for semantic search and memory retrieval.
 * Used by contextEnricher to add project knowledge to prompts.
 */

import { execSync, exec } from 'node:child_process'
import { join } from 'node:path'

const GbrainBin = join(
  process.env.HOME || '/root',
  '.openclaw/workspace/node_modules/.bin/gbrain',
)

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

/**
 * Check if GBrain is available.
 */
export function isGBrainAvailable(): boolean {
  try {
    execSync(`"${GbrainBin}" --version`, { timeout: 5000, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

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

  try {
    const results = await new Promise<GBrainResult[]>((resolve, reject) => {
      const cmd = `"${GbrainBin}" search "${query}" --top-k ${topK} --mode ${mode}`
      exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error) {
          resolve([]) // GBrain errors are non-critical
          return
        }

        try {
          const parsed = JSON.parse(stdout.trim())
          const items: GBrainResult[] = (parsed.results || parsed || [])
            .map((item: Record<string, unknown>) => ({
              content: String(item.content || item.text || ''),
              score: Number(item.score || item.relevance || 0),
              source: String(item.source || item.file || item.path || ''),
            }))
            .filter((r: GBrainResult) => r.content && r.score >= threshold)

          resolve(items)
        } catch {
          // Try to parse NDJSON
          const lines = stdout.trim().split('\n').filter(Boolean)
          const items: GBrainResult[] = lines
            .map(line => {
              try {
                const item = JSON.parse(line)
                return {
                  content: String(item.content || item.text || ''),
                  score: Number(item.score || 0),
                  source: String(item.source || ''),
                }
              } catch {
                return null
              }
            })
            .filter((r): r is GBrainResult => r !== null && r.content && r.score >= threshold)

          resolve(items)
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

/**
 * Import content into GBrain.
 */
export async function importToGBrain(
  filePath: string,
): Promise<boolean> {
  if (!isGBrainAvailable()) return false

  try {
    await new Promise<boolean>((resolve) => {
      exec(
        `"${GbrainBin}" import "${filePath}"`,
        { timeout: 60000 },
        (error) => resolve(!error),
      )
    })
    return true
  } catch {
    return false
  }
}

/**
 * Clear GBrain cache.
 */
export function clearCache(): void {
  GBRAIN_CACHE.clear()
}
