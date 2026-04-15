import type { LocalCommandCall } from '../../types/command.js'
import { remember, type MemoryEntry } from '../../services/memory/memoryStore.js'

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()

  if (!trimmed || trimmed === 'help') {
    return {
      type: 'text',
      value: [
        'Usage: /remember <key> <value> [tag1,tag2]',
        '',
        'Examples:',
        '  /remember name Sasha',
        '  /remember project CEOClaw pm-dashboard',
        '  /remember apiKey env:OPENAI_API_KEY sensitive,credentials',
        '',
        'Use /recall <key> to retrieve.',
        'Use /forget <key> to delete.',
        'Use /memories to list all.',
      ].join('\n'),
    }
  }

  // Parse: key value [tags]
  const parts = trimmed.match(/^(\S+)\s+([\s\S]*?)(?:\s+\[([^\]]+)\])?\s*$/)

  if (!parts) {
    return {
      type: 'text',
      value: 'Usage: /remember <key> <value> [tag1,tag2]',
    }
  }

  const [, key, value, tagsRaw] = parts
  const tags = tagsRaw?.split(',').map(t => t.trim()).filter(Boolean)

  const entry: MemoryEntry = remember(key!, value!, tags)

  // Auto-index for semantic search (async, non-blocking)
  import('../../services/memory/semanticSearch.js').then(({ indexMemory }) => {
    indexMemory(key!, value!).catch(() => {})
  }).catch(() => {})

  // Index into GBrain for hybrid search (async, non-blocking)
  import('../../services/memory/gbrainClient.js').then(({ importToGBrain, isGBrainAvailable }) => {
    if (isGBrainAvailable()) {
      const { writeFileSync, existsSync, mkdirSync } = require('fs')
      const { join } = require('path')
      const { homedir } = require('os')
      const dir = join(homedir(), '.freeclaude')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const tmpPath = join(dir, `memory-${key}.md`)
      writeFileSync(tmpPath, `# ${key}\n\n${value}\n\nTags: ${(tags ?? []).join(', ')}\n`, 'utf-8')
      importToGBrain(tmpPath).catch(() => {})
    }
  }).catch(() => {})

  const tagStr = tags?.length ? ` [${tags.join(', ')}]` : ''
  return {
    type: 'text',
    value: `✅ Remembered: ${entry.key}${tagStr}\n   ${entry.value}`,
  }
}
