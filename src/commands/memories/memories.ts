import type { LocalCommandCall } from '../../types/command.js'
import { listAll, exportMarkdown } from '../../services/memory/memoryStore.js'

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()
  const [subcommand] = trimmed.split(/\s+/)

  // /memories export — output as markdown
  if (trimmed === 'export') {
    return {
      type: 'text',
      value: exportMarkdown(),
    }
  }

  // /memories clear — delete all
  if (trimmed === 'clear') {
    const { clearAll } = await import('../../services/memory/memoryStore.js')
    const count = clearAll()
    return {
      type: 'text',
      value: `🗑 Cleared ${count} memories.`,
    }
  }

  // /memories gc — garbage collect low-confidence memories
  if (subcommand === 'gc') {
    try {
      const { gcMemories, getMemoryStats } = await import('../../services/memory/decay.js')
      const before = getMemoryStats()
      const result = gcMemories()
      return {
        type: 'text',
        value: [
          `🧹 Memory GC complete`,
          `   Removed: ${result.removed.length} entries (below 10% confidence)`,
          result.removed.length > 0 ? `   Keys: ${result.removed.join(', ')}` : '',
          `   Remaining: ${result.kept}`,
        ].filter(Boolean).join('\n'),
      }
    } catch (e) {
      return { type: 'text', value: `GC failed: ${e}` }
    }
  }

  // /memories consolidate — deduplicate and merge
  if (subcommand === 'consolidate' || subcommand === 'dedup') {
    try {
      const { consolidateMemories } = await import('../../services/memory/consolidation.js')
      const result = consolidateMemories()
      return {
        type: 'text',
        value: [
          `🔄 Consolidation: ${result.summary}`,
          result.removed.length > 0 ? `   Merged: ${result.removed.join(', ')}` : '',
        ].filter(Boolean).join('\n'),
      }
    } catch (e) {
      return { type: 'text', value: `Consolidation failed: ${e}` }
    }
  }

  // /memories index — auto-index vault/daily into GBrain
  if (subcommand === 'index') {
    try {
      const { autoIndexAll } = await import('../../services/memory/autoIndex.js')
      const result = await autoIndexAll()
      return {
        type: 'text',
        value: [
          `📇 GBrain Index`,
          `   Indexed: ${result.indexed} files`,
          `   Skipped: ${result.skipped} (unchanged)`,
          result.failed > 0 ? `   Failed: ${result.failed}` : '',
          result.files.length > 0 ? `   Files: ${result.files.map(f => f.split('/').slice(-2).join('/')).join(', ')}` : '',
        ].filter(Boolean).join('\n'),
      }
    } catch (e) {
      return { type: 'text', value: `Index failed: ${e}` }
    }
  }

  // /memories stats — show memory health
  if (subcommand === 'stats' || subcommand === 'health') {
    try {
      const { getMemoryStats } = await import('../../services/memory/decay.js')
      const { getIndexStats } = await import('../../services/memory/autoIndex.js')
      const { isGBrainAvailable } = await import('../../services/memory/gbrainClient.js')
      const { isOllamaAvailable } = await import('../../services/memory/semanticSearch.js')

      const memStats = getMemoryStats()
      const indexStats = getIndexStats()
      const gbrain = isGBrainAvailable()
      const ollama = await isOllamaAvailable()

      return {
        type: 'text',
        value: [
          `🧠 Memory Health`,
          '',
          `   Entries:     ${memStats.total}`,
          `   Healthy:     ${memStats.healthy} (>50% confidence)`,
          `   Stale:       ${memStats.stale} (10-50%)`,
          `   Dying:       ${memStats.dying} (<10%)`,
          `   Avg conf:    ${(memStats.averageConfidence * 100).toFixed(0)}%`,
          '',
          `   GBrain:      ${gbrain ? '✅' : '❌'} (${indexStats.totalIndexed} indexed)`,
          `   Ollama:      ${ollama ? '✅' : '❌'}`,
          `   Last scan:   ${indexStats.lastFullScan || 'never'}`,
        ].join('\n'),
      }
    } catch (e) {
      return { type: 'text', value: `Stats failed: ${e}` }
    }
  }

  // Default: list all memories
  const entries = listAll()

  if (entries.length === 0) {
    return {
      type: 'text',
      value: [
        'No memories stored yet.',
        '',
        'Usage:',
        '  /remember <key> <value> — save a memory',
        '  /recall <key> — retrieve (keyword + semantic + GBrain)',
        '  /forget <key> — delete',
        '  /memories export — export as markdown',
        '  /memories stats — memory health & backends',
        '  /memories gc — remove stale memories',
        '  /memories consolidate — deduplicate',
        '  /memories index — index vault/daily into GBrain',
        '  /memories clear — delete all',
      ].join('\n'),
    }
  }

  const lines = [`🧠 Memories (${entries.length})`, '']

  for (const entry of entries) {
    const tags = entry.tags?.length ? ` [${entry.tags.join(', ')}]` : ''
    const value = entry.value.length > 50 ? entry.value.slice(0, 47) + '...' : entry.value
    const time = new Date(entry.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })
    lines.push(`  🔑 ${entry.key}${tags}  ${value}  (${time})`)
  }

  lines.push('')
  lines.push('  /memories stats | gc | consolidate | index | export | clear')

  return {
    type: 'text',
    value: lines.join('\n'),
  }
}
