/**
 * FreeClaude v3 — Session Context Loader
 *
 * Automatically loads memory and recent daily notes into system prompt.
 * Called by openaiShim before every request — model sees context automatically.
 *
 * This is how FreeClaude remembers between sessions.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const FREECLAUDE_DIR = join(homedir(), '.freeclaude')
const DAILY_DIR = join(FREECLAUDE_DIR, 'daily')
const MEMORY_FILE = join(FREECLAUDE_DIR, 'memory.json')

interface MemoryEntry {
  key: string
  value: string
  tags?: string[]
}

function getToday(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getYesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Load all saved memories as a concise summary.
 */
function loadMemories(): string {
  if (!existsSync(MEMORY_FILE)) return ''

  try {
    const raw = readFileSync(MEMORY_FILE, 'utf-8')
    const store = JSON.parse(raw) as { entries: Record<string, MemoryEntry> }
    const entries = Object.values(store.entries)

    if (entries.length === 0) return ''

    const lines = ['## About the user (from memory):']
    for (const entry of entries) {
      // Skip system/technical entries, only show user-relevant ones
      if (entry.tags?.includes('система') || entry.tags?.includes('freeclaude')) continue
      lines.push(`- ${entry.key}: ${entry.value}`)
    }

    return lines.join('\n')
  } catch {
    return ''
  }
}

/**
 * Load today's and yesterday's daily notes.
 */
function loadDailyNotes(): string {
  const dates = [getToday(), getYesterday()]
  const sections: string[] = []

  for (const date of dates) {
    const filePath = join(DAILY_DIR, `${date}.md`)
    if (!existsSync(filePath)) continue

    try {
      const content = readFileSync(filePath, 'utf-8')
      // Truncate very long daily notes to avoid eating context
      const maxLen = 2000
      const truncated = content.length > maxLen
        ? content.slice(0, maxLen) + '\n...(truncated)'
        : content

      sections.push(`### ${date}\n${truncated}`)
    } catch {
      // Skip
    }
  }

  if (sections.length === 0) return ''

  return `## Recent conversation history:\n${sections.join('\n\n')}`
}

/**
 * Main entry point — builds the session context block.
 * This gets injected into the system prompt automatically.
 */
export async function loadSessionContext(): Promise<string> {
  const parts: string[] = []

  // 1. Load key memories about the user
  const memories = loadMemories()
  if (memories) parts.push(memories)

  // 2. Load recent daily notes (conversation history)
  const daily = loadDailyNotes()
  if (daily) parts.push(daily)

  if (parts.length === 0) return ''

  return `<freeclaude-memory>
This is your persistent memory from previous sessions. Use this context to remember the user, their preferences, and past conversations.

${parts.join('\n\n')}

</freeclaude-memory>`
}
