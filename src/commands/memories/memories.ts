import type { LocalCommandCall } from '../../types/command.js'
import { listAll, exportMarkdown } from '../../services/memory/memoryStore.js'

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()

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

  const entries = listAll()

  if (entries.length === 0) {
    return {
      type: 'text',
      value: [
        'No memories stored yet.',
        '',
        'Usage:',
        '  /remember <key> <value> — save a memory',
        '  /recall <key> — retrieve',
        '  /forget <key> — delete',
        '  /memories export — export as markdown',
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
  lines.push('  /recall <key> — retrieve  |  /forget <key> — delete  |  /memories export — markdown')

  return {
    type: 'text',
    value: lines.join('\n'),
  }
}
