import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export type VaultTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type VaultTaskReviewState = 'pending' | 'approved' | 'rejected'

export interface VaultTaskRecord {
  id: string
  shortId: string
  status: VaultTaskStatus
  cwd: string
  createdAt: string
  updatedAt: string
  reviewState?: VaultTaskReviewState
  pid?: number
  completedAt?: string
  vaultNotePath?: string
  pinned?: boolean
  archivedAt?: string
  summary?: string
  errorMessage?: string
  [key: string]: unknown
}

function nowIso(): string {
  return new Date().toISOString()
}

function freeclaudeHome(): string {
  return process.env.FREECLAUDE_HOME || join(homedir(), '.freeclaude')
}

function tasksDir(): string {
  return join(freeclaudeHome(), 'tasks')
}

function vaultDir(): string {
  return join(freeclaudeHome(), 'vault')
}

function vaultTasksDir(): string {
  return join(vaultDir(), 'tasks')
}

function vaultProjectsDir(): string {
  return join(vaultDir(), 'projects')
}

function vaultArchiveDir(): string {
  return join(vaultDir(), 'archive')
}

function ensureVaultTaskDirectories(): void {
  for (const dir of [
    freeclaudeHome(),
    tasksDir(),
    vaultDir(),
    vaultTasksDir(),
    vaultProjectsDir(),
    vaultArchiveDir(),
  ]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  try {
    const staleTempFiles = readdirSync(tasksDir()).filter(file =>
      file.endsWith('.tmp'),
    )
    for (const file of staleTempFiles) {
      const path = join(tasksDir(), file)
      const ageMs = Date.now() - statSync(path).mtimeMs
      if (ageMs > 60_000) {
        unlinkSync(path)
      }
    }
  } catch {
    // Best effort cleanup only.
  }
}

function taskRecordPath(taskId: string): string {
  return join(tasksDir(), `${taskId}.json`)
}

function readTaskRecord(path: string): VaultTaskRecord | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as VaultTaskRecord
  } catch {
    return null
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf-8')
  renameSync(tempPath, path)
}

function saveTaskRecord(task: VaultTaskRecord): VaultTaskRecord {
  ensureVaultTaskDirectories()
  writeJsonAtomic(taskRecordPath(task.id), task)
  return task
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function normalizeTaskHealth(task: VaultTaskRecord): VaultTaskRecord {
  if (task.status === 'running' && !isProcessAlive(task.pid)) {
    const staleTask: VaultTaskRecord = {
      ...task,
      status: 'failed',
      updatedAt: nowIso(),
      completedAt: task.completedAt ?? nowIso(),
      errorMessage:
        task.errorMessage ?? 'Task worker exited before writing a final result.',
      summary: task.summary ?? 'Task worker exited unexpectedly.',
    }
    return saveTaskRecord(staleTask)
  }
  return task
}

function updateVaultTask(
  taskId: string,
  updater: Partial<VaultTaskRecord>,
): VaultTaskRecord {
  const current = getVaultTask(taskId)
  if (!current) {
    throw new Error(`Task "${taskId}" not found`)
  }

  const next: VaultTaskRecord = {
    ...current,
    ...updater,
    updatedAt: updater.updatedAt ?? nowIso(),
  }
  return saveTaskRecord(next)
}

function rewriteTaskNoteFrontmatter(task: VaultTaskRecord): void {
  if (!task.vaultNotePath || !existsSync(task.vaultNotePath)) return

  let content = readFileSync(task.vaultNotePath, 'utf-8')
  content = content.replace(
    /^pinned:\s*(true|false)$/m,
    `pinned: ${task.pinned ? 'true' : 'false'}`,
  )
  content = content.replace(
    /^reviewState:\s*(pending|approved|rejected)$/m,
    `reviewState: ${task.reviewState ?? 'pending'}`,
  )
  content = content.replace(/^status:\s*(.+)$/m, `status: ${task.status}`)
  content = content.replace(/^updatedAt:\s*.+$/m, `updatedAt: ${task.updatedAt}`)
  writeFileSync(task.vaultNotePath, content, 'utf-8')
}

export function getVaultTask(taskId: string): VaultTaskRecord | null {
  ensureVaultTaskDirectories()
  const exactPath = taskRecordPath(taskId)
  if (existsSync(exactPath)) {
    const exact = readTaskRecord(exactPath)
    return exact ? normalizeTaskHealth(exact) : null
  }

  const candidates = readdirSync(tasksDir())
    .filter(name => name.endsWith('.json') && !name.endsWith('.events.jsonl'))
    .map(name => join(tasksDir(), name))
    .map(readTaskRecord)
    .filter((task): task is VaultTaskRecord => task !== null)
    .filter(task => task.id.startsWith(taskId) || task.shortId.startsWith(taskId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  if (candidates.length === 0) return null
  return normalizeTaskHealth(candidates[0]!)
}

export function setTaskPinned(taskId: string, pinned: boolean): VaultTaskRecord {
  const task = updateVaultTask(taskId, {
    pinned,
    updatedAt: nowIso(),
  })
  rewriteTaskNoteFrontmatter(task)
  return task
}

export function archiveTaskContext(taskId: string): VaultTaskRecord {
  const task = getVaultTask(taskId)
  if (!task) {
    throw new Error(`Task "${taskId}" not found`)
  }

  if (task.vaultNotePath && existsSync(task.vaultNotePath)) {
    const archivedPath = join(vaultArchiveDir(), basename(task.vaultNotePath))
    renameSync(task.vaultNotePath, archivedPath)
    return updateVaultTask(taskId, {
      archivedAt: nowIso(),
      vaultNotePath: archivedPath,
      updatedAt: nowIso(),
    })
  }

  return updateVaultTask(taskId, {
    archivedAt: nowIso(),
    updatedAt: nowIso(),
  })
}

export function forgetTaskContext(taskId: string): VaultTaskRecord {
  const task = getVaultTask(taskId)
  if (!task) {
    throw new Error(`Task "${taskId}" not found`)
  }

  if (task.vaultNotePath && existsSync(task.vaultNotePath)) {
    unlinkSync(task.vaultNotePath)
  }

  return updateVaultTask(taskId, {
    vaultNotePath: undefined,
    archivedAt: undefined,
    updatedAt: nowIso(),
  })
}

export function listVaultTasks(options: {
  includeArchived?: boolean
  limit?: number
} = {}): VaultTaskRecord[] {
  ensureVaultTaskDirectories()

  const records = readdirSync(tasksDir())
    .filter(name => name.endsWith('.json'))
    .filter(name => !name.endsWith('.events.jsonl'))
    .map(name => join(tasksDir(), name))
    .map(readTaskRecord)
    .filter((task): task is VaultTaskRecord => task !== null)
    .map(normalizeTaskHealth)
    .filter(task => Boolean(task.vaultNotePath))
    .filter(task => (options.includeArchived ? true : !task.archivedAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return typeof options.limit === 'number' ? records.slice(0, options.limit) : records
}

export function openVaultDirectoryPath(): string {
  ensureVaultTaskDirectories()
  return vaultDir()
}
