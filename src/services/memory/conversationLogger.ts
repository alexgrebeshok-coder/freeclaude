/**
 * FreeClaude v3 — Conversation Logger
 *
 * Automatically logs every user query and assistant response to daily notes.
 * Called from openaiShim after each message exchange.
 *
 * Storage: ~/.freeclaude/daily/YYYY-MM-DD.md
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DAILY_DIR = join(homedir(), '.freeclaude', 'daily')

function getToday(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getTime(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

function ensureDir(): void {
  if (!existsSync(DAILY_DIR)) {
    mkdirSync(DAILY_DIR, { recursive: true })
  }
}

function getHeader(): string {
  const today = getToday()
  const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
  const [y, m, d] = today.split('-').map(Number)
  const dt = new Date(y!, m! - 1, d!)
  return `# ${days[dt.getDay()]} ${d} ${months[dt.getMonth()!]} ${y}`
}

function truncate(text: string, maxLen = 500): string {
  const clean = text
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length <= maxLen) return clean
  return clean.slice(0, maxLen - 3) + '...'
}

/**
 * Log a user message to daily notes.
 */
export function logUserMessage(text: string): void {
  ensureDir()
  const filePath = join(DAILY_DIR, `${getToday()}.md`)

  let header = ''
  if (!existsSync(filePath)) {
    header = `${getHeader()}\n\n`
  }

  const entry = `\n### ${getTime()}\n❓ ${truncate(text)}\n`
  appendFileSync(filePath, header + entry, 'utf-8')
}

/**
 * Log an assistant response to daily notes.
 */
export function logAssistantMessage(text: string): void {
  ensureDir()
  const filePath = join(DAILY_DIR, `${getToday()}.md`)

  const entry = `💡 ${truncate(text)}\n`
  appendFileSync(filePath, entry, 'utf-8')
}
