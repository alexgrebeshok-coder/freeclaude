/**
 * FreeClaude v3 — Auto-Remember
 *
 * Detects user facts/preferences in conversation and auto-saves them.
 * Heuristics for both English and Russian triggers.
 *
 * Triggers:
 *   "запомни что...", "remember that...", "my name is...",
 *   "I prefer...", "always use...", "меня зовут..."
 */

import { remember } from './memoryStore.js'
import { importToGBrain, isGBrainAvailable } from './gbrainClient.js'
import { indexMemory } from './semanticSearch.js'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'

// Patterns that indicate user wants to save a fact
const REMEMBER_PATTERNS: Array<{
  pattern: RegExp
  extract: (match: RegExpMatchArray) => { key: string; value: string } | null
}> = [
  // Explicit: "запомни что X"
  {
    pattern: /^(?:запомни|запомни что|запомни,? что)\s+(.+)/i,
    extract: (m) => {
      const text = m[1]!.trim()
      const key = text.split(/\s+/).slice(0, 3).join('-').toLowerCase()
      return { key, value: text }
    },
  },
  // Explicit: "remember that X"
  {
    pattern: /^(?:remember that|remember:?)\s+(.+)/i,
    extract: (m) => {
      const text = m[1]!.trim()
      const key = text.split(/\s+/).slice(0, 3).join('-').toLowerCase()
      return { key, value: text }
    },
  },
  // Name: "my name is X" / "меня зовут X"
  {
    pattern: /(?:my name is|i'?m called|меня зовут|мое имя|моё имя)\s+(\S+)/i,
    extract: (m) => ({ key: 'user-name', value: m[1]!.trim() }),
  },
  // Preference: "I prefer X" / "я предпочитаю X"
  {
    pattern: /(?:i prefer|i always use|я предпочитаю|я использую)\s+(.+)/i,
    extract: (m) => {
      const text = m[1]!.trim()
      const key = `pref-${text.split(/\s+/).slice(0, 2).join('-').toLowerCase()}`
      return { key, value: text }
    },
  },
  // "always use X for Y"
  {
    pattern: /always use\s+(.+?)(?:\s+for\s+(.+))?$/i,
    extract: (m) => {
      const tool = m[1]!.trim()
      const context = m[2]?.trim()
      const key = context ? `pref-${context.split(/\s+/)[0]?.toLowerCase()}` : `pref-${tool.split(/\s+/)[0]?.toLowerCase()}`
      return { key, value: context ? `${tool} for ${context}` : tool }
    },
  },
]

export interface AutoRememberResult {
  detected: boolean
  key?: string
  value?: string
  saved?: boolean
}

/**
 * Check a user message for auto-remember triggers.
 * Returns what was detected and saved (if anything).
 */
export function detectAndRemember(userMessage: string): AutoRememberResult {
  const trimmed = userMessage.trim()
  if (trimmed.length < 5) return { detected: false }

  for (const { pattern, extract } of REMEMBER_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match) {
      const result = extract(match)
      if (result && result.key && result.value) {
        // Save to memory store
        remember(result.key, result.value, ['auto'])

        // Non-blocking: index for semantic + GBrain
        indexMemory(result.key, result.value).catch(() => {})
        if (isGBrainAvailable()) {
          const tmpPath = join(homedir(), '.freeclaude', 'tmp-autoremember.md')
          const dir = join(homedir(), '.freeclaude')
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
          writeFileSync(tmpPath, `# ${result.key}\n\n${result.value}\n`, 'utf-8')
          importToGBrain(tmpPath).catch(() => {})
        }

        return {
          detected: true,
          key: result.key,
          value: result.value,
          saved: true,
        }
      }
    }
  }

  return { detected: false }
}

/**
 * Check if a message looks like a rememberable fact (without saving).
 * Useful for dry-run / preview.
 */
export function wouldRemember(userMessage: string): AutoRememberResult {
  const trimmed = userMessage.trim()
  if (trimmed.length < 5) return { detected: false }

  for (const { pattern, extract } of REMEMBER_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match) {
      const result = extract(match)
      if (result) {
        return { detected: true, key: result.key, value: result.value, saved: false }
      }
    }
  }

  return { detected: false }
}
