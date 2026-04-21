/**
 * FreeClaude v3 — Memory Decay & Confidence
 *
 * Implements SuperMemory-style decay for memory entries:
 * - Each memory has a confidence score (0..1)
 * - Confidence decays by 5% per day since last access
 * - Access (recall) resets decay clock and boosts confidence
 * - GC removes memories below threshold
 *
 * Extended MemoryEntry fields stored alongside existing fields in memory.json:
 *   accessCount: number
 *   lastAccessedAt: string (ISO)
 *   confidence: number (0..1, default 1.0)
 */

import { loadMemory, saveMemory, type MemoryEntry, type MemoryStore } from './memoryStore.js'

const DECAY_RATE = 0.05     // 5% per day
const DEFAULT_CONFIDENCE = 1.0
const GC_THRESHOLD = 0.1   // Remove below 10%

export interface DecayMeta {
  accessCount: number
  lastAccessedAt: string
  confidence: number
}

/**
 * Get decay metadata for an entry.
 * Reads from extended fields stored in the entry object.
 */
export function getDecayMeta(entry: MemoryEntry): DecayMeta {
  const ext = entry as MemoryEntry & Partial<DecayMeta>
  return {
    accessCount: ext.accessCount ?? 0,
    lastAccessedAt: ext.lastAccessedAt ?? entry.updatedAt ?? entry.createdAt,
    confidence: ext.confidence ?? DEFAULT_CONFIDENCE,
  }
}

/**
 * Compute current confidence after time-based decay.
 */
export function computeConfidence(meta: DecayMeta, now: Date = new Date()): number {
  const lastAccess = new Date(meta.lastAccessedAt)
  const daysSinceAccess = (now.getTime() - lastAccess.getTime()) / (1000 * 60 * 60 * 24)

  if (daysSinceAccess <= 0) return meta.confidence

  // Exponential decay: confidence * (1 - rate)^days
  const decayed = meta.confidence * Math.pow(1 - DECAY_RATE, daysSinceAccess)
  return Math.max(0, Math.min(1, decayed))
}

/**
 * Record an access (recall/search hit) for an entry.
 * Resets decay clock, increments access count, boosts confidence.
 */
export function recordAccess(key: string): void {
  const store = loadMemory()
  const entry = store.entries[key]
  if (!entry) return

  const ext = entry as MemoryEntry & Partial<DecayMeta>
  const now = new Date().toISOString()

  ext.accessCount = (ext.accessCount ?? 0) + 1
  ext.lastAccessedAt = now
  // Boost confidence back to 1.0 on access
  ext.confidence = DEFAULT_CONFIDENCE

  store.entries[key] = ext as MemoryEntry
  saveMemory(store)
}

/**
 * Get all entries with their current confidence scores.
 */
export function getEntriesWithConfidence(now?: Date): Array<MemoryEntry & { currentConfidence: number }> {
  const store = loadMemory()
  return Object.values(store.entries).map(entry => {
    const meta = getDecayMeta(entry)
    return {
      ...entry,
      currentConfidence: computeConfidence(meta, now),
    }
  })
}

/**
 * Run garbage collection — remove entries below confidence threshold.
 * Returns count of removed entries.
 */
export function gcMemories(threshold: number = GC_THRESHOLD, now?: Date): {
  removed: string[]
  kept: number
} {
  const store = loadMemory()
  const removed: string[] = []
  const newEntries: Record<string, MemoryEntry> = {}

  for (const [storageKey, entry] of Object.entries(store.entries)) {
    const meta = getDecayMeta(entry)
    const conf = computeConfidence(meta, now)

    if (conf < threshold) {
      // Report the user-visible key (entry.key) rather than the internal
      // "global:..."/"project:..." storage key, which is an
      // implementation detail the caller doesn't know about.
      removed.push(entry.key ?? storageKey)
    } else {
      newEntries[storageKey] = entry
    }
  }

  if (removed.length > 0) {
    store.entries = newEntries
    saveMemory(store)
  }

  return {
    removed,
    kept: Object.keys(newEntries).length,
  }
}

/**
 * Get memory stats for display.
 */
export function getMemoryStats(now?: Date): {
  total: number
  healthy: number    // confidence > 0.5
  stale: number      // confidence 0.1..0.5
  dying: number      // confidence < 0.1
  averageConfidence: number
} {
  const entries = getEntriesWithConfidence(now)
  const total = entries.length

  if (total === 0) {
    return { total: 0, healthy: 0, stale: 0, dying: 0, averageConfidence: 0 }
  }

  let healthy = 0, stale = 0, dying = 0, sum = 0

  for (const e of entries) {
    sum += e.currentConfidence
    if (e.currentConfidence > 0.5) healthy++
    else if (e.currentConfidence >= GC_THRESHOLD) stale++
    else dying++
  }

  return {
    total,
    healthy,
    stale,
    dying,
    averageConfidence: sum / total,
  }
}
