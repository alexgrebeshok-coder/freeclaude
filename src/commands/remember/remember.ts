import type { LocalCommandCall } from '../../types/command.js'
import { remember, type MemoryEntry } from '../../services/memory/memoryStore.js'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Strip everything that is not a portable filename char so a malicious
// `/remember ../../evil ...` cannot traverse outside `~/.freeclaude`.
function sanitizeFilenameSegment(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'memory'
}

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

  // Index into GBrain for hybrid search (async, non-blocking).
  // Use proper ESM imports — `require` is not available in ESM modules
  // and previously threw `ReferenceError: require is not defined` at runtime.
  import('../../services/memory/gbrainClient.js').then(({ importToGBrain, isGBrainAvailable }) => {
    if (!isGBrainAvailable()) return
    const dir = join(homedir(), '.freeclaude')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const safeName = sanitizeFilenameSegment(key!)
    const tmpPath = join(dir, `memory-${safeName}.md`)
    try {
      writeFileSync(
        tmpPath,
        `# ${key}\n\n${value}\n\nTags: ${(tags ?? []).join(', ')}\n`,
        'utf-8',
      )
      importToGBrain(tmpPath)
        .catch(() => {})
        .finally(() => {
          try { unlinkSync(tmpPath) } catch { /* best effort cleanup */ }
        })
    } catch {
      /* best effort only — indexing is optional */
    }
  }).catch(() => {})

  const tagStr = tags?.length ? ` [${tags.join(', ')}]` : ''
  return {
    type: 'text',
    value: `✅ Remembered: ${entry.key}${tagStr}\n   ${entry.value}`,
  }
}
