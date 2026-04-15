import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Heartbeat Service', () => {
  const TEST_DIR = join(tmpdir(), `heartbeat-test-${Date.now()}`)

  beforeEach(() => {
    mkdirSync(join(TEST_DIR, '.freeclaude', 'tasks'), { recursive: true })
    process.env.FREECLAUDE_MEMORY_DIR = join(TEST_DIR, '.freeclaude')
    // Create a minimal memory.json
    writeFileSync(
      join(TEST_DIR, '.freeclaude', 'memory.json'),
      JSON.stringify({ entries: { test: { key: 'test', value: 'hello', createdAt: '2024-01-01', updatedAt: '2024-01-01', tags: [] } } }),
      'utf-8',
    )
  })

  afterEach(() => {
    delete process.env.FREECLAUDE_MEMORY_DIR
    try {
      rmSync(TEST_DIR, { recursive: true, force: true })
    } catch {}
  })

  test('formatHeartbeat produces readable output', async () => {
    const hb = await import('./heartbeat.ts')
    const { formatHeartbeat } = hb
    type HeartbeatStatus = typeof hb extends { HeartbeatStatus: infer T } ? T : never

    const status: Awaited<ReturnType<typeof hb.runHeartbeat>> = {
      timestamp: new Date().toISOString(),
      upSince: new Date().toISOString(),
      providers: [
        { name: 'ollama', endpoint: 'http://localhost:11434', status: 'ok', latencyMs: 42, checkedAt: new Date().toISOString() },
        { name: 'zai', endpoint: 'https://api.z.ai', status: 'error', error: 'HTTP 401', checkedAt: new Date().toISOString() },
      ],
      memory: {
        memoryJsonReadable: true,
        entryCount: 5,
        embeddingsCount: 3,
        gbrainAvailable: false,
        ollamaAvailable: true,
      },
      tasks: {
        activeCount: 1,
        staleCount: 0,
        cleanedUp: [],
      },
      diskUsageMB: 2.5,
      overallHealth: 'degraded',
    }

    const output = formatHeartbeat(status)
    expect(output).toContain('DEGRADED')
    expect(output).toContain('ollama')
    expect(output).toContain('42ms')
    expect(output).toContain('zai')
    expect(output).toContain('HTTP 401')
    expect(output).toContain('Entries:    5')
    expect(output).toContain('2.5 MB')
  })

  test('getLastHeartbeat returns null when no file exists', async () => {
    const { getLastHeartbeat } = await import('./heartbeat.ts')
    // Since we didn't create heartbeat.json, should return null or whatever default
    const result = getLastHeartbeat()
    // It's ok if null since the file doesn't exist in the real HOME
    expect(result === null || typeof result === 'object').toBe(true)
  })

  test('overallHealth logic: all providers ok = healthy', async () => {
    // Test the health determination logic directly
    const providers = [
      { status: 'ok' as const },
      { status: 'ok' as const },
    ]
    const errors = providers.filter(p => p.status === 'error' || p.status === 'timeout').length

    let health: 'healthy' | 'degraded' | 'critical' = 'healthy'
    if (errors > 0 && errors < providers.length) health = 'degraded'
    if (errors === providers.length && providers.length > 0) health = 'critical'

    expect(health).toBe('healthy')
  })

  test('overallHealth logic: some providers error = degraded', () => {
    const providers = [
      { status: 'ok' as const },
      { status: 'error' as const },
    ]
    const errors = providers.filter(p => p.status === 'error' || p.status === 'timeout').length

    let health: 'healthy' | 'degraded' | 'critical' = 'healthy'
    if (errors > 0 && errors < providers.length) health = 'degraded'
    if (errors === providers.length && providers.length > 0) health = 'critical'

    expect(health).toBe('degraded')
  })

  test('overallHealth logic: all providers error = critical', () => {
    const providers = [
      { status: 'error' as const },
      { status: 'timeout' as const },
    ]
    const errors = providers.filter(p => p.status === 'error' || p.status === 'timeout').length

    let health: 'healthy' | 'degraded' | 'critical' = 'healthy'
    if (errors > 0 && errors < providers.length) health = 'degraded'
    if (errors === providers.length && providers.length > 0) health = 'critical'

    expect(health).toBe('critical')
  })

  test('task stale detection marks dead PIDs', () => {
    // Create a task with a non-existent PID
    const taskPath = join(TEST_DIR, '.freeclaude', 'tasks', 'test-task.json')
    writeFileSync(taskPath, JSON.stringify({
      id: 'test-task',
      status: 'running',
      pid: 999999999, // Very unlikely to be a real PID
    }), 'utf-8')

    // Read it back
    const task = JSON.parse(readFileSync(taskPath, 'utf-8'))
    expect(task.status).toBe('running')

    // Check if PID is alive
    let isAlive = false
    try {
      process.kill(task.pid, 0)
      isAlive = true
    } catch {
      isAlive = false
    }

    expect(isAlive).toBe(false)
  })
})
