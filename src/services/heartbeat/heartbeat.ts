/**
 * FreeClaude v3 — Heartbeat Service
 *
 * Periodic self-check that monitors:
 * - Provider health (can we reach configured providers?)
 * - Memory integrity (memory.json readable, embedding index consistent)
 * - Active task/agent status (PIDs alive?)
 * - Disk space for ~/.freeclaude/
 *
 * Writes status to ~/.freeclaude/heartbeat.json
 * Can run as background interval or triggered manually via /heartbeat
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HEARTBEAT_FILE = join(homedir(), '.freeclaude', 'heartbeat.json')

export interface ProviderHealthCheck {
  name: string
  endpoint: string
  status: 'ok' | 'error' | 'timeout' | 'unchecked'
  latencyMs?: number
  error?: string
  checkedAt: string
}

export interface MemoryHealthCheck {
  memoryJsonReadable: boolean
  entryCount: number
  embeddingsCount: number
  gbrainAvailable: boolean
  ollamaAvailable: boolean
}

export interface TaskHealthCheck {
  activeCount: number
  staleCount: number
  cleanedUp: string[]
}

export interface HousekeepingReport {
  /** Job records removed by the background jobs prune pass. */
  prunedJobRecords: number
  /** Orphaned or pruned job log files. */
  prunedJobLogs: number
  /** Expired agent mailbox messages removed. */
  prunedMailboxMessages: number
}

export interface HeartbeatStatus {
  timestamp: string
  upSince: string
  providers: ProviderHealthCheck[]
  memory: MemoryHealthCheck
  tasks: TaskHealthCheck
  housekeeping?: HousekeepingReport
  diskUsageMB: number
  overallHealth: 'healthy' | 'degraded' | 'critical'
}

let _upSince: string = new Date().toISOString()
let _intervalId: ReturnType<typeof setInterval> | null = null

/**
 * Check provider connectivity.
 */
async function checkProviders(): Promise<ProviderHealthCheck[]> {
  const checks: ProviderHealthCheck[] = []

  try {
    const configPath = process.env.FREECLAUDE_CONFIG_PATH || join(homedir(), '.freeclaude.json')
    if (!existsSync(configPath)) return checks

    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    const providers = config.providers || []

    for (const provider of providers) {
      const name = provider.name || 'unknown'
      const endpoint = provider.baseUrl || provider.endpoint || ''

      if (!endpoint) {
        checks.push({
          name,
          endpoint: '(none)',
          status: 'unchecked',
          checkedAt: new Date().toISOString(),
        })
        continue
      }

      try {
        const start = Date.now()
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)

        const resp = await fetch(`${endpoint}/models`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${provider.apiKey || ''}`,
          },
          signal: controller.signal,
        })
        clearTimeout(timeout)

        checks.push({
          name,
          endpoint,
          status: resp.ok ? 'ok' : 'error',
          latencyMs: Date.now() - start,
          ...(resp.ok ? {} : { error: `HTTP ${resp.status}` }),
          checkedAt: new Date().toISOString(),
        })
      } catch (e: any) {
        checks.push({
          name,
          endpoint,
          status: e?.name === 'AbortError' ? 'timeout' : 'error',
          error: e?.message?.slice(0, 100),
          checkedAt: new Date().toISOString(),
        })
      }
    }
  } catch {
    // Config not readable
  }

  return checks
}

/**
 * Check memory subsystem health.
 */
async function checkMemory(): Promise<MemoryHealthCheck> {
  let memoryJsonReadable = false
  let entryCount = 0
  let embeddingsCount = 0
  let gbrainAvailable = false
  let ollamaAvailable = false

  try {
    const memFile = join(homedir(), '.freeclaude', 'memory.json')
    if (existsSync(memFile)) {
      const data = JSON.parse(readFileSync(memFile, 'utf-8'))
      memoryJsonReadable = true
      entryCount = Object.keys(data.entries || {}).length
    }
  } catch {
    memoryJsonReadable = false
  }

  try {
    const embFile = join(homedir(), '.freeclaude', 'embeddings.json')
    if (existsSync(embFile)) {
      const data = JSON.parse(readFileSync(embFile, 'utf-8'))
      embeddingsCount = (data.entries || []).length
    }
  } catch {}

  try {
    const { isGBrainAvailable } = await import('../memory/gbrainClient.js')
    gbrainAvailable = isGBrainAvailable()
  } catch {}

  try {
    const { isOllamaAvailable } = await import('../memory/semanticSearch.js')
    ollamaAvailable = await isOllamaAvailable()
  } catch {}

  return { memoryJsonReadable, entryCount, embeddingsCount, gbrainAvailable, ollamaAvailable }
}

/**
 * Check task/agent health — find stale PIDs and clean up.
 */
function checkTasks(): TaskHealthCheck {
  const cleanedUp: string[] = []
  let activeCount = 0
  let staleCount = 0

  try {
    const tasksDir = join(homedir(), '.freeclaude', 'tasks')
    if (!existsSync(tasksDir)) return { activeCount: 0, staleCount: 0, cleanedUp: [] }

    const files = readdirSync(tasksDir).filter(f => f.endsWith('.json'))

    for (const file of files) {
      try {
        const taskPath = join(tasksDir, file)
        const task = JSON.parse(readFileSync(taskPath, 'utf-8'))

        if (task.status === 'running' && task.pid) {
          // Check if PID is alive
          try {
            process.kill(task.pid, 0) // Signal 0 = check existence
            activeCount++
          } catch {
            // PID is dead — mark as stale
            task.status = 'failed'
            task.error = 'Process died unexpectedly (detected by heartbeat)'
            task.updatedAt = new Date().toISOString()
            writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf-8')
            staleCount++
            cleanedUp.push(task.id || file)
          }
        } else if (task.status === 'running') {
          // No PID — might be stuck
          activeCount++
        }
      } catch {
        // Skip unreadable task files
      }
    }
  } catch {}

  return { activeCount, staleCount, cleanedUp }
}

/**
 * Calculate disk usage of ~/.freeclaude/ in MB.
 */
function getDiskUsageMB(): number {
  try {
    const dir = join(homedir(), '.freeclaude')
    if (!existsSync(dir)) return 0

    let totalBytes = 0
    const walk = (d: string) => {
      try {
        for (const entry of readdirSync(d)) {
          const full = join(d, entry)
          const stat = statSync(full)
          if (stat.isDirectory()) walk(full)
          else totalBytes += stat.size
        }
      } catch {}
    }
    walk(dir)
    return Math.round(totalBytes / (1024 * 1024) * 10) / 10
  } catch {
    return 0
  }
}

/**
 * Best-effort housekeeping — prune old background jobs and expired
 * agent inbox/outbox messages. Never throws; failures are swallowed so
 * the main heartbeat cycle is never blocked by housekeeping errors.
 */
async function runHousekeeping(): Promise<HousekeepingReport> {
  const report: HousekeepingReport = {
    prunedJobRecords: 0,
    prunedJobLogs: 0,
    prunedMailboxMessages: 0,
  }

  try {
    const { pruneOldJobs } = await import('../jobs/jobStore.js')
    const result = pruneOldJobs()
    report.prunedJobRecords = result.removedRecords
    report.prunedJobLogs = result.removedLogs
  } catch {
    /* non-critical */
  }

  try {
    const { pruneExpiredMailboxes } = await import('../agents/agentProtocol.js')
    report.prunedMailboxMessages = pruneExpiredMailboxes()
  } catch {
    /* non-critical */
  }

  return report
}

/**
 * Run a full heartbeat check.
 */
export async function runHeartbeat(): Promise<HeartbeatStatus> {
  const [providers, memory, tasks, housekeeping] = await Promise.all([
    checkProviders(),
    checkMemory(),
    Promise.resolve(checkTasks()),
    runHousekeeping(),
  ])

  const diskUsageMB = getDiskUsageMB()

  // Determine overall health
  let overallHealth: 'healthy' | 'degraded' | 'critical' = 'healthy'
  const providerErrors = providers.filter(p => p.status === 'error' || p.status === 'timeout').length
  if (providerErrors > 0 && providerErrors < providers.length) overallHealth = 'degraded'
  if (providerErrors === providers.length && providers.length > 0) overallHealth = 'critical'
  if (!memory.memoryJsonReadable && memory.entryCount > 0) overallHealth = 'critical'
  if (tasks.staleCount > 0) overallHealth = overallHealth === 'healthy' ? 'degraded' : overallHealth

  const status: HeartbeatStatus = {
    timestamp: new Date().toISOString(),
    upSince: _upSince,
    providers,
    memory,
    tasks,
    housekeeping,
    diskUsageMB,
    overallHealth,
  }

  // Persist
  const dir = join(homedir(), '.freeclaude')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(HEARTBEAT_FILE, JSON.stringify(status, null, 2), 'utf-8')

  return status
}

/**
 * Run memory maintenance: GC + consolidation.
 */
export async function runMaintenance(): Promise<{
  gc: { removed: string[]; kept: number }
  consolidation: { merged: number; removed: string[] }
}> {
  const { gcMemories } = await import('../memory/decay.js')
  const { consolidateMemories } = await import('../memory/consolidation.js')

  const gc = gcMemories()
  const consolidation = consolidateMemories()

  return { gc, consolidation }
}

/**
 * Start periodic heartbeat (background interval).
 */
export function startHeartbeat(intervalMs: number = 5 * 60 * 1000): void {
  if (_intervalId) return // Already running

  _upSince = new Date().toISOString()
  // Run immediately
  runHeartbeat().catch(() => {})

  _intervalId = setInterval(() => {
    runHeartbeat().catch(() => {})
  }, intervalMs)

  // Don't keep the process alive solely because of the heartbeat timer.
  // Long-running hosts (telegram bot, daemon) will keep the event loop
  // busy on their own; short CLI invocations that accidentally import
  // this module shouldn't hang.
  if (_intervalId && typeof _intervalId.unref === 'function') {
    _intervalId.unref()
  }
}

/**
 * Stop periodic heartbeat.
 */
export function stopHeartbeat(): void {
  if (_intervalId) {
    clearInterval(_intervalId)
    _intervalId = null
  }
}

/**
 * Get last heartbeat status from file.
 */
export function getLastHeartbeat(): HeartbeatStatus | null {
  try {
    if (!existsSync(HEARTBEAT_FILE)) return null
    return JSON.parse(readFileSync(HEARTBEAT_FILE, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Format heartbeat status for CLI display.
 */
export function formatHeartbeat(status: HeartbeatStatus): string {
  const healthEmoji = {
    healthy: '💚',
    degraded: '🟡',
    critical: '🔴',
  }

  const lines: string[] = [
    `${healthEmoji[status.overallHealth]} System Health: ${status.overallHealth.toUpperCase()}`,
    `   Last check: ${new Date(status.timestamp).toLocaleString()}`,
    `   Up since:   ${new Date(status.upSince).toLocaleString()}`,
    `   Disk:       ${status.diskUsageMB} MB`,
    '',
  ]

  // Providers
  if (status.providers.length > 0) {
    lines.push('   Providers:')
    for (const p of status.providers) {
      const icon = p.status === 'ok' ? '✅' : p.status === 'timeout' ? '⏱️' : p.status === 'unchecked' ? '⬜' : '❌'
      const latency = p.latencyMs ? ` (${p.latencyMs}ms)` : ''
      const err = p.error ? ` — ${p.error}` : ''
      lines.push(`     ${icon} ${p.name}${latency}${err}`)
    }
    lines.push('')
  }

  // Memory
  lines.push('   Memory:')
  lines.push(`     📝 Entries:    ${status.memory.entryCount}`)
  lines.push(`     🧮 Embeddings: ${status.memory.embeddingsCount}`)
  lines.push(`     🧠 GBrain:     ${status.memory.gbrainAvailable ? '✅' : '❌'}`)
  lines.push(`     🦙 Ollama:     ${status.memory.ollamaAvailable ? '✅' : '❌'}`)
  lines.push('')

  // Tasks
  if (status.tasks.activeCount > 0 || status.tasks.staleCount > 0) {
    lines.push('   Tasks:')
    lines.push(`     ▶️  Active: ${status.tasks.activeCount}`)
    if (status.tasks.staleCount > 0) {
      lines.push(`     ⚠️  Stale:  ${status.tasks.staleCount} (cleaned up: ${status.tasks.cleanedUp.join(', ')})`)
    }
  }

  if (status.housekeeping) {
    const { prunedJobRecords, prunedJobLogs, prunedMailboxMessages } = status.housekeeping
    if (prunedJobRecords + prunedJobLogs + prunedMailboxMessages > 0) {
      lines.push('')
      lines.push('   Housekeeping:')
      if (prunedJobRecords > 0) lines.push(`     🧹 Pruned job records:   ${prunedJobRecords}`)
      if (prunedJobLogs > 0) lines.push(`     🧹 Pruned job logs:      ${prunedJobLogs}`)
      if (prunedMailboxMessages > 0) lines.push(`     🧹 Pruned mailbox msgs:  ${prunedMailboxMessages}`)
    }
  }

  return lines.join('\n')
}
