import type { LocalCommandCall } from '../../types/command.js'
import { recall as recallEntry, search, type MemoryEntry } from '../../services/memory/memoryStore.js'

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()

  if (!trimmed || trimmed === 'help') {
    return {
      type: 'text',
      value: [
        'Usage: /recall <key|query>',
        '',
        'Searches memories by key, value, or tags.',
        'Sources: exact match → keyword → Ollama semantic → GBrain hybrid',
        '',
        'Examples:',
        '  /recall name          — exact key match',
        '  /recall project       — search by key/value/tags',
        '  /recall что мы делали — semantic + hybrid search',
      ].join('\n'),
    }
  }

  // Try exact match first
  const exact = recallEntry(trimmed)
  if (exact) {
    // Record access for decay tracking
    recordAccessSafe(exact.key)
    return formatEntry(exact, 'exact')
  }

  // Keyword search
  const results = search(trimmed)

  // Try semantic search if available
  let semanticResults: Array<{ key: string; value: string; score: number }> = []
  try {
    const { isOllamaAvailable, semanticSearch } = await import('../../services/memory/semanticSearch.js')
    if (await isOllamaAvailable()) {
      semanticResults = await semanticSearch(trimmed, 3)
    }
  } catch {
    // Semantic search not available
  }

  // Try GBrain hybrid search
  let gbrainResults: Array<{ content: string; score: number; source: string }> = []
  try {
    const { searchGBrain, isGBrainAvailable } = await import('../../services/memory/gbrainClient.js')
    if (isGBrainAvailable()) {
      gbrainResults = await searchGBrain(trimmed, { topK: 3, threshold: 0.4 })
    }
  } catch {
    // GBrain not available
  }

  // Merge results (keyword first, then semantic, then GBrain)
  const seenKeys = new Set(results.map(r => r.key))
  for (const sr of semanticResults) {
    if (!seenKeys.has(sr.key)) {
      results.push({
        key: sr.key,
        value: sr.value,
        createdAt: '',
        updatedAt: '',
        tags: [],
      } as MemoryEntry)
      seenKeys.add(sr.key)
    }
  }

  // Add GBrain results as synthetic entries
  for (const gr of gbrainResults) {
    const gKey = `gbrain:${gr.source}`
    if (!seenKeys.has(gKey)) {
      results.push({
        key: gKey,
        value: gr.content,
        createdAt: '',
        updatedAt: '',
        tags: ['gbrain'],
      } as MemoryEntry)
      seenKeys.add(gKey)
    }
  }

  // Record access for all found keys
  for (const r of results) {
    if (!r.key.startsWith('gbrain:')) {
      recordAccessSafe(r.key)
    }
  }

  if (results.length === 0) {
    return {
      type: 'text',
      value: `Nothing found for "${trimmed}".\n\nUse /remember to save a memory.`,
    }
  }

  if (results.length === 1) {
    return formatEntry(results[0]!, 'search')
  }

  // Multiple results
  const hasSemantic = semanticResults.length > 0
  const hasGBrain = gbrainResults.length > 0
  const sources: string[] = ['keyword']
  if (hasSemantic) sources.push('semantic')
  if (hasGBrain) sources.push('GBrain')

  const lines = [`Found ${results.length} memories matching "${trimmed}" (${sources.join(' + ')}):`, '']
  for (const entry of results) {
    const tags = entry.tags?.length ? ` [${entry.tags.join(', ')}]` : ''
    const semScore = semanticResults.find(s => s.key === entry.key)
    const gScore = gbrainResults.find(g => `gbrain:${g.source}` === entry.key)
    let scoreStr = ''
    if (semScore) scoreStr = ` (semantic: ${(semScore.score * 100).toFixed(0)}%)`
    if (gScore) scoreStr = ` (gbrain: ${(gScore.score * 100).toFixed(0)}%)`
    lines.push(`  🔑 ${entry.key}${tags}${scoreStr}`)
    lines.push(`     ${entry.value.length > 60 ? entry.value.slice(0, 57) + '...' : entry.value}`)
    lines.push('')
  }

  return {
    type: 'text',
    value: lines.join('\n'),
  }
}

function formatEntry(entry: MemoryEntry, source: string): { type: 'text'; value: string } {
  const tags = entry.tags?.length ? `\n   Tags: ${entry.tags.join(', ')}` : ''
  const updated = entry.updatedAt ? `\n   Updated: ${new Date(entry.updatedAt).toLocaleString()}` : ''
  const sourceStr = source !== 'exact' ? ` (via ${source})` : ''

  return {
    type: 'text',
    value: `🔑 ${entry.key}${sourceStr}\n   ${entry.value}${tags}${updated}`,
  }
}

function recordAccessSafe(key: string): void {
  try {
    const { recordAccess } = require('../../services/memory/decay.js')
    recordAccess(key)
  } catch {
    // Decay tracking not critical
  }
}
