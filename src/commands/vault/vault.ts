import type { LocalCommandCall } from '../../types/command.js'
import {
  listVaultTasks,
  openVaultDirectoryPath,
  getTask,
  setTaskPinned,
  archiveTaskContext,
  forgetTaskContext,
} from '../../services/tasks/taskManager.js'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'

function vaultRoot(): string {
  return join(homedir(), '.freeclaude', 'vault')
}

function ensureVaultDirs(): void {
  for (const sub of ['', 'tasks', 'projects', 'archive', 'notes']) {
    const dir = join(vaultRoot(), sub)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }
}

interface VaultEntry {
  name: string
  path: string
  type: 'task' | 'project' | 'note' | 'archive'
  pinned: boolean
  preview: string
  updatedAt: string
}

function scanVaultFiles(): VaultEntry[] {
  ensureVaultDirs()
  const entries: VaultEntry[] = []
  const root = vaultRoot()

  const subdirs: Array<{ dir: string; type: VaultEntry['type'] }> = [
    { dir: 'tasks', type: 'task' },
    { dir: 'projects', type: 'project' },
    { dir: 'notes', type: 'note' },
    { dir: 'archive', type: 'archive' },
  ]

  for (const { dir, type } of subdirs) {
    const fullDir = join(root, dir)
    if (!existsSync(fullDir)) continue
    try {
      const files = readdirSync(fullDir).filter(f => f.endsWith('.md'))
      for (const file of files) {
        const filePath = join(fullDir, file)
        const content = readFileSync(filePath, 'utf-8')
        const pinned = /^pinned:\s*true$/m.test(content)
        const updatedMatch = content.match(/^updatedAt:\s*(.+)$/m)
        const preview = extractPreview(content)
        entries.push({
          name: file.replace(/\.md$/, ''),
          path: filePath,
          type,
          pinned,
          preview,
          updatedAt: updatedMatch?.[1] ?? '',
        })
      }
    } catch {
      // Skip unreadable dirs
    }
  }

  // Also check root-level .md files
  try {
    const rootFiles = readdirSync(root).filter(f => f.endsWith('.md'))
    for (const file of rootFiles) {
      const filePath = join(root, file)
      const content = readFileSync(filePath, 'utf-8')
      const pinned = /^pinned:\s*true$/m.test(content)
      const updatedMatch = content.match(/^updatedAt:\s*(.+)$/m)
      entries.push({
        name: file.replace(/\.md$/, ''),
        path: filePath,
        type: 'note',
        pinned,
        preview: extractPreview(content),
        updatedAt: updatedMatch?.[1] ?? '',
      })
    }
  } catch {
    // Skip
  }

  return entries
}

function extractPreview(content: string): string {
  // Skip frontmatter, get first non-empty body line
  const lines = content.split('\n')
  let inFrontmatter = false
  for (const line of lines) {
    if (line.trim() === '---') {
      inFrontmatter = !inFrontmatter
      continue
    }
    if (inFrontmatter) continue
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      return trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed
    }
  }
  return '(empty)'
}

function formatList(entries: VaultEntry[], showType = true): string {
  if (entries.length === 0) {
    return 'No vault notes found.\n\nUse /vault new <title> to create one.'
  }

  // Sort: pinned first, then by updatedAt desc
  entries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })

  const lines: string[] = [`📓 Vault (${entries.length} notes)`, '']
  for (const entry of entries) {
    const pin = entry.pinned ? '📌 ' : '   '
    const typeTag = showType ? ` [${entry.type}]` : ''
    lines.push(`${pin}${entry.name}${typeTag}`)
    lines.push(`     ${entry.preview}`)
    lines.push('')
  }

  lines.push('Commands: /vault show <name> | /vault search <query> | /vault new <title>')
  return lines.join('\n')
}

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()
  const [subcommand, ...rest] = trimmed.split(/\s+/)
  const subArgs = rest.join(' ')

  if (!trimmed || trimmed === 'help') {
    return {
      type: 'text',
      value: [
        'Usage: /vault <subcommand> [args]',
        '',
        'Subcommands:',
        '  list              — List all vault notes',
        '  show <name>       — Show note content',
        '  search <query>    — Full-text search across all notes',
        '  new <title>       — Create a standalone note',
        '  pin <name>        — Pin a note',
        '  unpin <name>      — Unpin a note',
        '  archive <name>    — Move note to archive',
        '  forget <name>     — Delete a note permanently',
        '  open              — Show vault directory path',
        '',
        'Notes are stored as Markdown files in ~/.freeclaude/vault/',
        'Task results automatically create vault notes.',
      ].join('\n'),
    }
  }

  switch (subcommand) {
    case 'list':
    case 'ls':
      return handleList(subArgs)
    case 'show':
    case 'cat':
    case 'read':
      return handleShow(subArgs)
    case 'search':
    case 'grep':
    case 'find':
      return handleSearch(subArgs)
    case 'new':
    case 'create':
      return handleNew(subArgs)
    case 'pin':
      return handlePin(subArgs, true)
    case 'unpin':
      return handlePin(subArgs, false)
    case 'archive':
      return handleArchive(subArgs)
    case 'forget':
    case 'delete':
    case 'rm':
      return handleForget(subArgs)
    case 'open':
      return handleOpen()
    default:
      // Treat as search query
      return handleSearch(trimmed)
  }
}

function handleList(filter: string): { type: 'text'; value: string } {
  const entries = scanVaultFiles()
  if (filter) {
    const filtered = entries.filter(e =>
      e.type === filter || e.name.includes(filter),
    )
    return { type: 'text', value: formatList(filtered) }
  }
  return { type: 'text', value: formatList(entries) }
}

function handleShow(name: string): { type: 'text'; value: string } {
  if (!name) {
    return { type: 'text', value: 'Usage: /vault show <name>' }
  }

  const entries = scanVaultFiles()
  const match = entries.find(e =>
    e.name === name || e.name.toLowerCase() === name.toLowerCase(),
  )

  if (!match) {
    // Try partial match
    const partial = entries.filter(e =>
      e.name.toLowerCase().includes(name.toLowerCase()),
    )
    if (partial.length === 1) {
      const content = readFileSync(partial[0]!.path, 'utf-8')
      return { type: 'text', value: `📄 ${partial[0]!.name} [${partial[0]!.type}]\n\n${content}` }
    }
    if (partial.length > 1) {
      return {
        type: 'text',
        value: `Multiple matches for "${name}":\n\n${partial.map(e => `  ${e.name} [${e.type}]`).join('\n')}\n\nBe more specific.`,
      }
    }
    return { type: 'text', value: `Note "${name}" not found. Use /vault list to see all notes.` }
  }

  const content = readFileSync(match.path, 'utf-8')
  return { type: 'text', value: `📄 ${match.name} [${match.type}]\n\n${content}` }
}

function handleSearch(query: string): { type: 'text'; value: string } {
  if (!query) {
    return { type: 'text', value: 'Usage: /vault search <query>' }
  }

  const entries = scanVaultFiles()
  const queryLower = query.toLowerCase()
  const matches: Array<VaultEntry & { matchLine: string }> = []

  for (const entry of entries) {
    try {
      const content = readFileSync(entry.path, 'utf-8')
      const lines = content.split('\n')
      for (const line of lines) {
        if (line.toLowerCase().includes(queryLower)) {
          matches.push({ ...entry, matchLine: line.trim() })
          break
        }
      }
    } catch {
      // Skip
    }
  }

  if (matches.length === 0) {
    return { type: 'text', value: `No results for "${query}" in vault.` }
  }

  const lines: string[] = [`🔍 Found ${matches.length} notes matching "${query}"`, '']
  for (const m of matches) {
    const pin = m.pinned ? '📌 ' : '   '
    lines.push(`${pin}${m.name} [${m.type}]`)
    const highlighted = m.matchLine.length > 80 ? m.matchLine.slice(0, 77) + '...' : m.matchLine
    lines.push(`     ${highlighted}`)
    lines.push('')
  }

  return { type: 'text', value: lines.join('\n') }
}

function handleNew(title: string): { type: 'text'; value: string } {
  if (!title) {
    return { type: 'text', value: 'Usage: /vault new <title>' }
  }

  ensureVaultDirs()
  const slug = title
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

  const notePath = join(vaultRoot(), 'notes', `${slug}.md`)
  if (existsSync(notePath)) {
    return { type: 'text', value: `Note "${slug}" already exists. Use /vault show ${slug} to view.` }
  }

  const now = new Date().toISOString()
  const content = [
    '---',
    'type: note',
    `title: ${title}`,
    `createdAt: ${now}`,
    `updatedAt: ${now}`,
    'pinned: false',
    '---',
    '',
    `# ${title}`,
    '',
    '',
  ].join('\n')

  writeFileSync(notePath, content, 'utf-8')
  return {
    type: 'text',
    value: `✅ Created vault note: ${slug}\n   Path: ${notePath}\n\nEdit the file or use /vault show ${slug}`,
  }
}

function handlePin(name: string, pinned: boolean): { type: 'text'; value: string } {
  if (!name) {
    return { type: 'text', value: `Usage: /vault ${pinned ? 'pin' : 'unpin'} <name>` }
  }

  // First try task-linked vault notes
  const tasks = listVaultTasks({ includeArchived: true })
  const taskMatch = tasks.find(t =>
    t.shortId === name || t.id === name || basename(t.vaultNotePath ?? '').replace('.md', '') === name,
  )
  if (taskMatch) {
    setTaskPinned(taskMatch.id, pinned)
    return {
      type: 'text',
      value: `${pinned ? '📌 Pinned' : '📌 Unpinned'}: ${taskMatch.shortId} (${taskMatch.summary || taskMatch.status})`,
    }
  }

  // Try standalone files — toggle pinned in frontmatter
  const entries = scanVaultFiles()
  const match = findEntry(entries, name)
  if (!match) {
    return { type: 'text', value: `Note "${name}" not found.` }
  }

  const content = readFileSync(match.path, 'utf-8')
  const updated = content.replace(
    /^pinned:\s*(true|false)$/m,
    `pinned: ${pinned}`,
  )
  writeFileSync(match.path, updated, 'utf-8')
  return {
    type: 'text',
    value: `${pinned ? '📌 Pinned' : '📌 Unpinned'}: ${match.name}`,
  }
}

function handleArchive(name: string): { type: 'text'; value: string } {
  if (!name) {
    return { type: 'text', value: 'Usage: /vault archive <name>' }
  }

  // Try task-linked
  const tasks = listVaultTasks()
  const taskMatch = tasks.find(t =>
    t.shortId === name || t.id === name || basename(t.vaultNotePath ?? '').replace('.md', '') === name,
  )
  if (taskMatch) {
    archiveTaskContext(taskMatch.id)
    return { type: 'text', value: `📦 Archived: ${taskMatch.shortId}` }
  }

  // Try standalone
  const entries = scanVaultFiles()
  const match = findEntry(entries, name)
  if (!match) {
    return { type: 'text', value: `Note "${name}" not found.` }
  }
  if (match.type === 'archive') {
    return { type: 'text', value: `"${match.name}" is already archived.` }
  }

  ensureVaultDirs()
  const archivePath = join(vaultRoot(), 'archive', basename(match.path))
  const { renameSync } = require('fs')
  renameSync(match.path, archivePath)
  return { type: 'text', value: `📦 Archived: ${match.name}` }
}

function handleForget(name: string): { type: 'text'; value: string } {
  if (!name) {
    return { type: 'text', value: 'Usage: /vault forget <name>' }
  }

  // Try task-linked
  const tasks = listVaultTasks({ includeArchived: true })
  const taskMatch = tasks.find(t =>
    t.shortId === name || t.id === name || basename(t.vaultNotePath ?? '').replace('.md', '') === name,
  )
  if (taskMatch) {
    forgetTaskContext(taskMatch.id)
    return { type: 'text', value: `🗑️ Deleted: ${taskMatch.shortId}` }
  }

  // Try standalone
  const entries = scanVaultFiles()
  const match = findEntry(entries, name)
  if (!match) {
    return { type: 'text', value: `Note "${name}" not found.` }
  }

  const { unlinkSync } = require('fs')
  unlinkSync(match.path)
  return { type: 'text', value: `🗑️ Deleted: ${match.name}` }
}

function handleOpen(): { type: 'text'; value: string } {
  const dir = openVaultDirectoryPath()
  return { type: 'text', value: `📁 Vault directory: ${dir}` }
}

function findEntry(entries: VaultEntry[], name: string): VaultEntry | undefined {
  return (
    entries.find(e => e.name === name) ||
    entries.find(e => e.name.toLowerCase() === name.toLowerCase()) ||
    entries.find(e => e.name.toLowerCase().includes(name.toLowerCase()))
  )
}
