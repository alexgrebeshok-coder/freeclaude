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
        'If Ollama is running with nomic-embed-text, also does semantic search.',
        '',
        'Examples:',
        '  /recall name          — exact key match',
        '  /recall project       — search by key/value/tags',
        '  /recall что мы делали — semantic search (if Ollama available)',
      ].join('\n'),
    }
  }

  // Try exact match first
  const exact = recallEntry(trimmed)
  if (exact) {
    return formatEntry(exact)
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
    // Semantic search not available — use keyword results only
  }

  // Merge results (keyword first, then semantic if not duplicate)
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

  if (results.length === 0) {
    return {
      type: 'text',
      value: `Nothing found for "${trimmed}".\n\nUse /remember to save a memory.`,
    }
  }

  if (results.length === 1) {
    return formatEntry(results[0]!)
  }

  // Multiple results
  const hasSemantic = semanticResults.length > 0
  const lines = [`Found ${results.length} memories matching "${trimmed}"${hasSemantic ? ' (semantic)' : ''}:`, '']
  for (const entry of results) {
    const tags = entry.tags?.length ? ` [${entry.tags.join(', ')}]` : ''
    const semScore = semanticResults.find(s => s.key === entry.key)
    const scoreStr = semScore ? ` (${(semScore.score * 100).toFixed(0)}%)` : ''
    lines.push(`  🔑 ${entry.key}${tags}${scoreStr}`)
    lines.push(`     ${entry.value.length > 60 ? entry.value.slice(0, 57) + '...' : entry.value}`)
    lines.push('')
  }

  return {
    type: 'text',
    value: lines.join('\n'),
  }
}

function formatEntry(entry: MemoryEntry): { type: 'text'; value: string } {
  const tags = entry.tags?.length ? `\n   Tags: ${entry.tags.join(', ')}` : ''
  const updated = entry.updatedAt ? `\n   Updated: ${new Date(entry.updatedAt).toLocaleString()}` : ''

  return {
    type: 'text',
    value: `🔑 ${entry.key}\n   ${entry.value}${tags}${updated}`,
  }
}
