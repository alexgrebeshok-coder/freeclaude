/**
 * FreeClaude v3 — /daily Command
 *
 * Daily notes — write/read session summaries.
 *
 * Usage:
 *   /daily                  — show today's notes
 *   /daily show             — show today's notes
 *   /daily show 2026-04-12 — show specific date
 *   /daily list             — list recent daily files
 *   /daily some text here   — append to today's notes
 */

import type { LocalCommandCall } from '../../types/command.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DAILY_DIR = join(homedir(), '.freeclaude', 'daily')

function ensureDir(): void {
  if (!existsSync(DAILY_DIR)) {
    mkdirSync(DAILY_DIR, { recursive: true })
  }
}

function getToday(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getFilePath(date: string): string {
  return join(DAILY_DIR, `${date}.md`)
}

function getDateStr(date: string): string {
  const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y!, m! - 1, d!)
  return `${days[dt.getDay()]} ${d} ${months[dt.getMonth()!]} ${y}`
}

function showNotes(date: string): string {
  const filePath = getFilePath(date)
  if (!existsSync(filePath)) {
    return `📅 ${getDateStr(date)} — нет записей`
  }
  const content = readFileSync(filePath, 'utf-8')
  return `📅 ${getDateStr(date)}\n${'─'.repeat(40)}\n${content}`
}

function listRecent(): string {
  ensureDir()
  if (!existsSync(DAILY_DIR)) return 'Нет дневниковых записей.'

  const files = readdirSync(DAILY_DIR)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, 7)

  if (files.length === 0) return 'Нет дневниковых записей.'

  const lines = ['📒 Последние записи:', '']
  for (const file of files) {
    const date = file.replace('.md', '')
    const stat = readFileSync(join(DAILY_DIR, file), 'utf-8')
    const lineCount = stat.split('\n').length
    lines.push(`  ${date} (${getDateStr(date)}) — ${lineCount} строк`)
  }
  lines.push('')
  lines.push('Используйте: /daily show YYYY-MM-DD')
  return lines.join('\n')
}

function appendToToday(text: string): string {
  ensureDir()
  const today = getToday()
  const filePath = getFilePath(today)
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  let content = ''
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf-8')
    if (!content.endsWith('\n')) content += '\n'
  } else {
    content = `# Daily Notes — ${getDateStr(today)}\n\n`
  }

  content += `### ${time}\n${text}\n\n`
  writeFileSync(filePath, content, 'utf-8')

  return `✅ Записано в ${today}.md (${time})\n${'─'.repeat(40)}\n${text}`
}

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()

  // /daily list — show recent files
  if (trimmed === 'list' || trimmed === 'ls') {
    return { type: 'text', value: listRecent() }
  }

  // /daily show [date] — show specific date
  if (trimmed.startsWith('show')) {
    const datePart = trimmed.replace('show', '').trim()
    const date = datePart || getToday()
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { type: 'text', value: 'Формат даты: YYYY-MM-DD (например 2026-04-13)' }
    }
    return { type: 'text', value: showNotes(date) }
  }

  // /daily help
  if (trimmed === 'help' || trimmed === '--help' || trimmed === '-h') {
    return {
      type: 'text',
      value: [
        'Usage:',
        '  /daily                    — показать записи за сегодня',
        '  /daily show               — показать записи за сегодня',
        '  /daily show 2026-04-12    — показать записи за дату',
        '  /daily list               — список последних 7 дней',
        '  /daily текст здесь        — дописать в дневник',
        '',
        'Файлы: ~/.freeclaude/daily/YYYY-MM-DD.md',
      ].join('\n'),
    }
  }

  // /daily — show today
  if (trimmed === '') {
    return { type: 'text', value: showNotes(getToday()) }
  }

  // /daily <text> — append to today's notes
  return { type: 'text', value: appendToToday(trimmed) }
}
