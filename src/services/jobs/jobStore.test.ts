import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let testCounter = 0
let testDir = ''

beforeEach(() => {
  testCounter++
  testDir = join(tmpdir(), `fc-jobs-${process.pid}-${testCounter}`)
  process.env.FREECLAUDE_JOBS_DIR = testDir
})

afterEach(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* noop */ }
  delete process.env.FREECLAUDE_JOBS_DIR
})

describe('jobStore', () => {
  test('saveJob and readAllJobs round-trip through records/', async () => {
    const { saveJob, readAllJobs } = await import('./jobStore.ts')
    const job = {
      id: 'abc12345',
      prompt: 'test prompt',
      status: 'running' as const,
      createdAt: new Date().toISOString(),
      pid: -1, // deliberately dead pid so status flips to "stale"
    }
    saveJob(job)

    const jobs = readAllJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.id).toBe('abc12345')
    // dead pid -> stale reconciliation
    expect(jobs[0]!.status).toBe('stale')
  })

  test('readAllJobs deduplicates by id, records/ wins over index.jsonl', async () => {
    const { saveJob, readAllJobs, getRecordsDir, getIndexPath } = await import('./jobStore.ts')

    const base = {
      id: 'dup00001',
      prompt: 'p',
      createdAt: new Date().toISOString(),
    }
    // index.jsonl: "running" entry (legacy)
    mkdirSync(testDir, { recursive: true })
    writeFileSync(
      getIndexPath(),
      JSON.stringify({ ...base, status: 'running', pid: process.pid }) + '\n',
      'utf-8',
    )
    // records/: "completed" entry (new format)
    mkdirSync(getRecordsDir(), { recursive: true })
    writeFileSync(
      join(getRecordsDir(), 'dup00001.json'),
      JSON.stringify({ ...base, status: 'completed', exitCode: 0 }),
      'utf-8',
    )

    const jobs = readAllJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.status).toBe('completed')
    expect(jobs[0]!.exitCode).toBe(0)
  })

  test('isProcessAlive rejects invalid pids', async () => {
    const { isProcessAlive } = await import('./jobStore.ts')
    expect(isProcessAlive(undefined)).toBe(false)
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-1)).toBe(false)
    // The current process is always alive.
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  test('tailLog returns "" for missing log, tail bytes for present log', async () => {
    const { tailLog, logPathFor, ensureJobDirs } = await import('./jobStore.ts')
    ensureJobDirs()
    const job = { id: 'tailjob1', prompt: 'p', status: 'running' as const, createdAt: new Date().toISOString() }
    expect(tailLog(job, 100)).toBe('')

    const path = logPathFor('tailjob1')
    writeFileSync(path, 'x'.repeat(500), 'utf-8')
    const short = tailLog(job, 100)
    expect(short.startsWith('...(truncated)')).toBe(true)
    expect(short.endsWith('x')).toBe(true)
  })

  test('pruneOldJobs removes finished records older than maxAgeMs', async () => {
    const { saveJob, pruneOldJobs, readAllJobs } = await import('./jobStore.ts')
    const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

    saveJob({
      id: 'old00001',
      prompt: 'old',
      status: 'completed',
      createdAt: longAgo,
      completedAt: longAgo,
      exitCode: 0,
    })
    saveJob({
      id: 'new00001',
      prompt: 'new',
      status: 'completed',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      exitCode: 0,
    })

    const result = pruneOldJobs({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 })
    expect(result.removedRecords).toBeGreaterThanOrEqual(1)

    const remaining = readAllJobs()
    expect(remaining.map(j => j.id)).toContain('new00001')
    expect(remaining.map(j => j.id)).not.toContain('old00001')
  })

  test('pruneOldJobs never removes running jobs', async () => {
    const { saveJob, pruneOldJobs, readAllJobs } = await import('./jobStore.ts')
    const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    saveJob({
      id: 'run00001',
      prompt: 'running',
      status: 'running',
      createdAt: longAgo,
      pid: process.pid, // this process is always alive in-test
    })

    pruneOldJobs({ maxAgeMs: 1 })
    const remaining = readAllJobs()
    expect(remaining.map(j => j.id)).toContain('run00001')
  })

  test('pruneOldJobs enforces maxFinishedCount cap', async () => {
    const { saveJob, pruneOldJobs, readAllJobs } = await import('./jobStore.ts')
    for (let i = 0; i < 5; i++) {
      saveJob({
        id: `fin${String(i).padStart(5, '0')}`,
        prompt: `job ${i}`,
        status: 'completed',
        createdAt: new Date(Date.now() - (10 - i) * 1000).toISOString(),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      })
    }
    pruneOldJobs({ maxFinishedCount: 2, maxAgeMs: 10 * 365 * 24 * 60 * 60 * 1000 })
    const remaining = readAllJobs()
    expect(remaining.filter(j => j.status === 'completed')).toHaveLength(2)
  })

  test('pruneOldJobs deletes orphaned log files', async () => {
    const { pruneOldJobs, getLogsDir, ensureJobDirs } = await import('./jobStore.ts')
    ensureJobDirs()
    const orphanPath = join(getLogsDir(), 'orphan01.log')
    writeFileSync(orphanPath, 'nothing references me', 'utf-8')
    expect(existsSync(orphanPath)).toBe(true)

    pruneOldJobs()
    expect(existsSync(orphanPath)).toBe(false)
  })
})
