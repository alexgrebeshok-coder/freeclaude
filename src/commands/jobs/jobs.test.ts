import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

type JobRecord = {
  id: string
  prompt: string
  status: 'running' | 'completed' | 'failed'
  createdAt: string
  completedAt?: string
  exitCode?: number
  pid?: number
  output?: string
}

function createTestJobsDir(): string {
  const dir = join(tmpdir(), `fc-jobs-test-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.jsonl'), JSON.stringify({
    id: 'abc12345',
    prompt: 'refactor auth module',
    status: 'completed',
    createdAt: '2026-04-12T09:00:00Z',
    completedAt: '2026-04-12T09:02:30Z',
    exitCode: 0,
    output: 'Refactored 3 files successfully.',
  }) as string + '\n' + JSON.stringify({
    id: 'def67890',
    prompt: 'fix typescript errors',
    status: 'running',
    createdAt: '2026-04-12T09:05:00Z',
  }) as string + '\n' + JSON.stringify({
    id: 'ghi11111',
    prompt: 'broken task',
    status: 'failed',
    createdAt: '2026-04-12T08:00:00Z',
    completedAt: '2026-04-12T08:00:05Z',
    exitCode: 1,
    output: 'Error: Cannot find module',
  }) as string + '\n')
  return dir
}

function readJobs(dir: string): JobRecord[] {
  const indexPath = join(dir, 'index.jsonl')
  if (!existsSync(indexPath)) return []
  return readFileSync(indexPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(Boolean)
    .reverse()
}

function formatDuration(start: string, end?: string): string {
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function statusIcon(status: string): string {
  switch (status) {
    case 'running': return '🔄'
    case 'completed': return '✅'
    case 'failed': return '❌'
    default: return '❓'
  }
}

describe('Background Jobs System', () => {
  test('reads jobs from JSONL file', () => {
    const dir = createTestJobsDir()
    try {
      const jobs = readJobs(dir)
      expect(jobs).toHaveLength(3)
      expect(jobs[0]!.id).toBe('ghi11111') // newest first (reversed)
      expect(jobs[1]!.id).toBe('def67890')
      expect(jobs[2]!.id).toBe('abc12345')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('status icons are correct', () => {
    expect(statusIcon('running')).toBe('🔄')
    expect(statusIcon('completed')).toBe('✅')
    expect(statusIcon('failed')).toBe('❌')
    expect(statusIcon('unknown')).toBe('❓')
  })

  test('formatDuration works', () => {
    expect(formatDuration('2026-04-12T09:00:00Z', '2026-04-12T09:00:01Z')).toBe('1.0s')
    expect(formatDuration('2026-04-12T09:00:00Z', '2026-04-12T09:00:00Z')).toBe('0ms')
    expect(formatDuration('2026-04-12T09:00:00Z', '2026-04-12T09:02:30Z')).toBe('2m 30s')
  })

  test('jobs have correct structure', () => {
    const dir = createTestJobsDir()
    try {
      const jobs = readJobs(dir)
      const completed = jobs.find(j => j.id === 'abc12345')!
      expect(completed.status).toBe('completed')
      expect(completed.exitCode).toBe(0)
      expect(completed.output).toContain('3 files')

      const running = jobs.find(j => j.id === 'def67890')!
      expect(running.status).toBe('running')
      expect(running.completedAt).toBeUndefined()

      const failed = jobs.find(j => j.id === 'ghi11111')!
      expect(failed.status).toBe('failed')
      expect(failed.exitCode).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('empty jobs dir returns empty array', () => {
    const dir = join(tmpdir(), `fc-jobs-empty-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      const jobs = readJobs(dir)
      expect(jobs).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('handles malformed JSONL gracefully', () => {
    const dir = join(tmpdir(), `fc-jobs-malformed-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.jsonl'), '{"id":"ok"}\nbad json\n{"id":"also-ok"}\n')
    try {
      const jobs = readJobs(dir)
      expect(jobs).toHaveLength(2)
      expect(jobs[0]!.id).toBe('also-ok')
      expect(jobs[1]!.id).toBe('ok')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
