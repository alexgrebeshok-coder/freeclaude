import type { LocalCommandCall } from '../../types/command.js'
import { recall as recallEntry, search, type MemoryEntry } from '../../services/memory/memoryStore.js'

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()

  if (!trimmed) {
    return {
      type: 'text',
      value: 'Usage: /recall <key|query>\n\nSearches by key, value, or tags.',
    }
  }

  // Try exact match first
  const exact = recallEntry(trimmed)
  if (exact) {
    return formatEntry(exact)
  }

  // Fuzzy search
  const results = search(trimmed)
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
  const lines = [`Found ${results.length} memories matching "${trimmed}":`, '']
  for (const entry of results) {
    const tags = entry.tags?.length ? ` [${entry.tags.join(', ')}]` : ''
    lines.push(`  🔑 ${entry.key}${tags}`)
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
  const updated = `\n   Updated: ${new Date(entry.updatedAt).toLocaleString()}`

  return {
    type: 'text',
    value: `🔑 ${entry.key}\n   ${entry.value}${tags}${updated}`,
  }
}
