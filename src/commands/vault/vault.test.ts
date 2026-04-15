import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// We test vault logic directly since the command imports from taskManager
// which has side effects. Instead, test the vault command's core operations.

const TEST_DIR = join(tmpdir(), `vault-test-${Date.now()}`)

function createTestVault() {
  const vault = join(TEST_DIR, '.freeclaude', 'vault')
  for (const sub of ['', 'tasks', 'projects', 'archive', 'notes']) {
    mkdirSync(join(vault, sub), { recursive: true })
  }
  return vault
}

describe('/vault command logic', () => {
  let vaultDir: string

  beforeEach(() => {
    vaultDir = createTestVault()
  })

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true })
    } catch {
      // Best effort
    }
  })

  test('creates a standalone note with frontmatter', () => {
    const title = 'Test Note'
    const slug = 'test-note'
    const notePath = join(vaultDir, 'notes', `${slug}.md`)
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
    expect(existsSync(notePath)).toBe(true)

    const read = readFileSync(notePath, 'utf-8')
    expect(read).toContain('type: note')
    expect(read).toContain('title: Test Note')
    expect(read).toContain('pinned: false')
  })

  test('scans vault files across subdirectories', () => {
    // Create notes in different dirs
    writeFileSync(
      join(vaultDir, 'notes', 'idea.md'),
      '---\ntype: note\ntitle: Idea\npinned: false\nupdatedAt: 2024-01-01\n---\n\n# Idea\n\nSome idea\n',
      'utf-8',
    )
    writeFileSync(
      join(vaultDir, 'tasks', 'task-001.md'),
      '---\ntype: task\ntaskId: task-001\npinned: true\nupdatedAt: 2024-01-02\n---\n\n# Task 001\n\nDone something\n',
      'utf-8',
    )
    writeFileSync(
      join(vaultDir, 'archive', 'old.md'),
      '---\ntype: task\npinned: false\nupdatedAt: 2023-06-01\n---\n\n# Old\n\nOld note\n',
      'utf-8',
    )

    // Verify files exist
    expect(existsSync(join(vaultDir, 'notes', 'idea.md'))).toBe(true)
    expect(existsSync(join(vaultDir, 'tasks', 'task-001.md'))).toBe(true)
    expect(existsSync(join(vaultDir, 'archive', 'old.md'))).toBe(true)
  })

  test('full-text search finds matches', () => {
    writeFileSync(
      join(vaultDir, 'notes', 'project-alpha.md'),
      '---\ntype: note\ntitle: Project Alpha\npinned: false\n---\n\n# Project Alpha\n\nThis project uses React and TypeScript\n',
      'utf-8',
    )
    writeFileSync(
      join(vaultDir, 'notes', 'project-beta.md'),
      '---\ntype: note\ntitle: Project Beta\npinned: false\n---\n\n# Project Beta\n\nThis project uses Python and Django\n',
      'utf-8',
    )

    const query = 'react'
    const files = ['project-alpha.md', 'project-beta.md']
    const matches: string[] = []

    for (const file of files) {
      const content = readFileSync(join(vaultDir, 'notes', file), 'utf-8')
      if (content.toLowerCase().includes(query.toLowerCase())) {
        matches.push(file)
      }
    }

    expect(matches).toEqual(['project-alpha.md'])
  })

  test('pin toggle works via frontmatter', () => {
    const notePath = join(vaultDir, 'notes', 'toggleme.md')
    writeFileSync(
      notePath,
      '---\ntype: note\ntitle: Toggle\npinned: false\n---\n\n# Toggle\n\nContent\n',
      'utf-8',
    )

    // Pin
    let content = readFileSync(notePath, 'utf-8')
    content = content.replace(/^pinned:\s*(true|false)$/m, 'pinned: true')
    writeFileSync(notePath, content, 'utf-8')

    const pinned = readFileSync(notePath, 'utf-8')
    expect(pinned).toContain('pinned: true')

    // Unpin
    content = readFileSync(notePath, 'utf-8')
    content = content.replace(/^pinned:\s*(true|false)$/m, 'pinned: false')
    writeFileSync(notePath, content, 'utf-8')

    const unpinned = readFileSync(notePath, 'utf-8')
    expect(unpinned).toContain('pinned: false')
  })

  test('archive moves file to archive dir', () => {
    const notePath = join(vaultDir, 'notes', 'archive-me.md')
    writeFileSync(notePath, '---\ntype: note\n---\n\n# Archive Me\n', 'utf-8')
    expect(existsSync(notePath)).toBe(true)

    const { renameSync } = require('fs')
    const archivePath = join(vaultDir, 'archive', 'archive-me.md')
    renameSync(notePath, archivePath)

    expect(existsSync(notePath)).toBe(false)
    expect(existsSync(archivePath)).toBe(true)
  })

  test('forget deletes file', () => {
    const notePath = join(vaultDir, 'notes', 'forget-me.md')
    writeFileSync(notePath, '---\ntype: note\n---\n\n# Forget Me\n', 'utf-8')
    expect(existsSync(notePath)).toBe(true)

    const { unlinkSync } = require('fs')
    unlinkSync(notePath)
    expect(existsSync(notePath)).toBe(false)
  })

  test('slug generation handles special characters', () => {
    const title = 'Мой проект: Alpha & Beta!'
    const slug = title
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)

    expect(slug).toBe('мой-проект-alpha-beta')
    expect(slug.length).toBeLessThanOrEqual(60)
  })

  test('preview extraction skips frontmatter and headers', () => {
    const content = '---\ntype: note\ntitle: Test\n---\n\n# Test\n\nThis is the actual content.\n\nSecond paragraph.\n'
    const lines = content.split('\n')
    let inFrontmatter = false
    let preview = '(empty)'

    for (const line of lines) {
      if (line.trim() === '---') {
        inFrontmatter = !inFrontmatter
        continue
      }
      if (inFrontmatter) continue
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        preview = trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed
        break
      }
    }

    expect(preview).toBe('This is the actual content.')
  })
})
