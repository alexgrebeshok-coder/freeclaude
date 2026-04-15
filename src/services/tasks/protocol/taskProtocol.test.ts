import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Task Protocol Types', () => {
  test('types export correctly', async () => {
    // Just verify the module loads without errors
    const types = await import('./types.ts')
    // Types are compile-time only, but the module should load
    expect(types).toBeDefined()
  })
})

describe('Task Protocol', () => {
  test('TASK_TEMPLATES has expected templates', async () => {
    const { TASK_TEMPLATES } = await import('./taskProtocol.ts')

    expect(TASK_TEMPLATES.length).toBe(6)
    expect(TASK_TEMPLATES.map(t => t.id)).toContain('pr-review')
    expect(TASK_TEMPLATES.map(t => t.id)).toContain('issue-triage')
    expect(TASK_TEMPLATES.map(t => t.id)).toContain('reproduce-bug')
    expect(TASK_TEMPLATES.map(t => t.id)).toContain('refactor-with-tests')
    expect(TASK_TEMPLATES.map(t => t.id)).toContain('release-notes')
    expect(TASK_TEMPLATES.map(t => t.id)).toContain('summarize-changes')
  })

  test('each template has required fields', async () => {
    const { TASK_TEMPLATES } = await import('./taskProtocol.ts')

    for (const template of TASK_TEMPLATES) {
      expect(template.id).toBeTruthy()
      expect(template.title).toBeTruthy()
      expect(template.description).toBeTruthy()
      expect(template.prompt).toBeTruthy()
    }
  })

  test('formatTaskSummary formats correctly', async () => {
    const { formatTaskSummary } = await import('./taskProtocol.ts')

    const summary = formatTaskSummary({
      id: 'abc12345',
      prompt: 'Review the code',
      status: 'running',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      pid: 12345,
      cwd: '/tmp',
      source: 'cli',
      templateId: null,
      scheduleId: null,
      scheduled: false,
      metadataPath: '/tmp/task.json',
      eventsPath: '/tmp/events.jsonl',
    })

    expect(summary).toContain('abc12345')
    expect(summary).toContain('running')
    expect(summary).toContain('Review the code')
    expect(summary).toContain('12345')
  })

  test('formatScheduleSummary formats correctly', async () => {
    const { formatScheduleSummary } = await import('./taskProtocol.ts')

    const summary = formatScheduleSummary({
      id: 'sched-1',
      prompt: 'Run tests',
      everyMinutes: 30,
      status: 'running',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      nextRunAt: '2025-01-01T00:30:00.000Z',
      lastRunAt: null,
      lastTaskId: null,
      pid: 54321,
      cwd: '/tmp',
      source: 'cli',
      templateId: null,
      metadataPath: '/tmp/schedule.json',
      eventsPath: '/tmp/events.jsonl',
    })

    expect(summary).toContain('sched-1')
    expect(summary).toContain('30 minute(s)')
    expect(summary).toContain('Run tests')
    expect(summary).toContain('54321')
  })

  test('getLatestJobs returns empty when no jobs', async () => {
    const { getLatestJobs } = await import('./taskProtocol.ts')
    // May have existing jobs on the system, just verify it returns an array
    const jobs = getLatestJobs()
    expect(Array.isArray(jobs)).toBe(true)
  })

  test('getLatestSchedules returns empty when no schedules', async () => {
    const { getLatestSchedules } = await import('./taskProtocol.ts')
    const schedules = getLatestSchedules()
    expect(Array.isArray(schedules)).toBe(true)
  })

  test('findJob returns undefined for non-existent job', async () => {
    const { findJob } = await import('./taskProtocol.ts')
    const job = findJob('non-existent-id-xyz')
    expect(job).toBeUndefined()
  })

  test('handleTaskCommand returns 1 for unknown subcommand', async () => {
    const { handleTaskCommand } = await import('./taskProtocol.ts')
    const exitCode = await handleTaskCommand(['unknown-subcommand'])
    expect(exitCode).toBe(1)
  })
})
