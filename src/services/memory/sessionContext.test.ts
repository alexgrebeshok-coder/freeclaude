import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ENV_MEMORY_DIR,
  ENV_MEMORY_PROJECT,
  remember,
} from './memoryStore.js'

let testCounter = 0

function getToday(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

beforeEach(() => {
  testCounter++
  process.env[ENV_MEMORY_DIR] = join(tmpdir(), `fc-session-context-${testCounter}`)
  process.env[ENV_MEMORY_PROJECT] = `rag-project-${testCounter}`
  mkdirSync(process.env[ENV_MEMORY_DIR]!, { recursive: true })
})

afterEach(() => {
  const dir = process.env[ENV_MEMORY_DIR]
  delete process.env[ENV_MEMORY_DIR]
  delete process.env[ENV_MEMORY_PROJECT]
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('sessionContext', () => {
  test('builds query-aware retrieved context from memory and notes', async () => {
    const projectKey = process.env[ENV_MEMORY_PROJECT]!
    remember('db-engine', 'Use PostgreSQL with Prisma for this project.', {
      scope: 'project',
      projectKey,
      category: 'decision',
    })
    remember('tone', 'Keep responses concise.', {
      scope: 'global',
      category: 'preference',
    })

    const dailyDir = join(process.env[ENV_MEMORY_DIR]!, 'daily', projectKey)
    mkdirSync(dailyDir, { recursive: true })
    writeFileSync(
      join(dailyDir, `${getToday()}.md`),
      [
        '# Standup',
        '',
        'We finalized the database migration plan.',
        'Switch the service to PostgreSQL and keep Prisma as the ORM layer.',
        '',
        'Unrelated reminder about release screenshots.',
      ].join('\n'),
      'utf-8',
    )

    const { loadSessionContext } = await import('./sessionContext.ts')
    const context = await loadSessionContext('How should we handle the PostgreSQL migration in this project?')

    expect(context).toContain('## Relevant retrieved context:')
    expect(context).toContain('db-engine')
    expect(context).toContain('PostgreSQL')
    expect(context).not.toContain('## Recent conversation history:')
  })

  test('keeps fallback persistent memory and recent history when there is no query', async () => {
    const projectKey = process.env[ENV_MEMORY_PROJECT]!
    remember('stack', 'Use TypeScript everywhere.', {
      scope: 'project',
      projectKey,
      category: 'decision',
    })

    const dailyDir = join(process.env[ENV_MEMORY_DIR]!, 'daily')
    mkdirSync(dailyDir, { recursive: true })
    writeFileSync(
      join(dailyDir, `${getToday()}.md`),
      'Discussed repository cleanup and testing follow-ups.',
      'utf-8',
    )

    const { loadSessionContext } = await import('./sessionContext.ts')
    const context = await loadSessionContext()

    expect(context).toContain('## Persistent memory:')
    expect(context).toContain('Use TypeScript everywhere.')
    expect(context).toContain('## Recent conversation history:')
  })
})
