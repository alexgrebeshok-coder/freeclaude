/**
 * FreeClaude v3 — Memory Consolidation
 *
 * Deduplicates and summarizes memory entries.
 * - Finds entries with similar keys/values
 * - Merges duplicates
 * - Optionally summarizes verbose entries
 */

import { loadMemory, saveMemory, type MemoryEntry } from './memoryStore.js'
import { getDecayMeta, computeConfidence } from './decay.js'

export interface ConsolidationResult {
  merged: number
  removed: string[]
  kept: number
  summary: string
}

/**
 * Find entries with similar keys using Levenshtein-like comparison.
 */
function keySimilarity(a: string, b: string): number {
  const al = a.toLowerCase()
  const bl = b.toLowerCase()
  if (al === bl) return 1.0

  // Check if one contains the other
  if (al.includes(bl) || bl.includes(al)) return 0.8

  // Check prefix match
  let prefixLen = 0
  for (let i = 0; i < Math.min(al.length, bl.length); i++) {
    if (al[i] === bl[i]) prefixLen++
    else break
  }
  if (prefixLen >= 3 && prefixLen / Math.max(al.length, bl.length) > 0.6) return 0.7

  return 0
}

/**
 * Find entries with similar values.
 */
function valueSimilarity(a: string, b: string): number {
  const al = a.toLowerCase()
  const bl = b.toLowerCase()
  if (al === bl) return 1.0
  if (al.includes(bl) || bl.includes(al)) return 0.7

  // Word overlap
  const wordsA = new Set(al.split(/\s+/))
  const wordsB = new Set(bl.split(/\s+/))
  let overlap = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++
  }
  const totalWords = Math.max(wordsA.size, wordsB.size)
  if (totalWords === 0) return 0
  return overlap / totalWords
}

/**
 * Run memory consolidation.
 * Merges similar entries, keeping the one with higher confidence.
 */
export function consolidateMemories(options: {
  keySimilarityThreshold?: number
  valueSimilarityThreshold?: number
  dryRun?: boolean
} = {}): ConsolidationResult {
  const {
    keySimilarityThreshold = 0.7,
    valueSimilarityThreshold = 0.8,
    dryRun = false,
  } = options

  const store = loadMemory()
  const entries = Object.values(store.entries)
  const toRemove = new Set<string>()

  // Compare all pairs
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!
      const b = entries[j]!

      if (toRemove.has(a.key) || toRemove.has(b.key)) continue

      const kSim = keySimilarity(a.key, b.key)
      const vSim = valueSimilarity(a.value, b.value)

      // Merge if keys are very similar OR values are near-identical
      if (kSim >= keySimilarityThreshold || vSim >= valueSimilarityThreshold) {
        // Keep the one with higher confidence (or more recent if equal)
        const aMeta = getDecayMeta(a)
        const bMeta = getDecayMeta(b)
        const aConf = computeConfidence(aMeta)
        const bConf = computeConfidence(bMeta)

        if (aConf >= bConf) {
          // Keep a, merge b's tags into a
          if (b.tags?.length) {
            a.tags = [...new Set([...(a.tags ?? []), ...b.tags])]
          }
          // If b has more info, append to a's value
          if (b.value.length > a.value.length && vSim < 0.9) {
            a.value = `${a.value}\n\n(Also: ${b.value})`
          }
          toRemove.add(b.key)
        } else {
          if (a.tags?.length) {
            b.tags = [...new Set([...(b.tags ?? []), ...a.tags])]
          }
          if (a.value.length > b.value.length && vSim < 0.9) {
            b.value = `${b.value}\n\n(Also: ${a.value})`
          }
          toRemove.add(a.key)
        }
      }
    }
  }

  if (!dryRun && toRemove.size > 0) {
    for (const key of toRemove) {
      delete store.entries[key]
    }
    saveMemory(store)
  }

  const removed = [...toRemove]
  const kept = entries.length - removed.length

  return {
    merged: removed.length,
    removed,
    kept,
    summary: removed.length > 0
      ? `Merged ${removed.length} duplicate entries. ${kept} entries remain.`
      : `No duplicates found. ${kept} entries clean.`,
  }
}

/**
 * Get consolidation preview (dry run).
 */
export function previewConsolidation(): ConsolidationResult {
  return consolidateMemories({ dryRun: true })
}
