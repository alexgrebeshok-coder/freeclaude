/**
 * FreeClaude Task Protocol — Shared Types
 *
 * Used by taskProtocol.ts, taskRunner.ts, and taskScheduler.ts.
 * These files are compiled SEPARATELY from the main bundle
 * to keep fast-path startup.
 */

// ---------------------------------------------------------------------------
// Task types
// ---------------------------------------------------------------------------

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type ScheduleStatus = 'running' | 'paused' | 'cancelled'

export interface TaskTemplate {
  id: string
  title: string
  description: string
  prompt: string
}

export interface TaskMetadata {
  cwd: string
  source: 'cli' | 'slash' | 'schedule' | 'agent'
  templateId: string | null
  scheduleId: string | null
  scheduled: boolean
}

export interface TaskRecord {
  id: string
  prompt: string
  status: TaskStatus
  createdAt: string
  updatedAt: string
  completedAt?: string
  pid?: number
  exitCode?: number
  output?: string
  metadataPath: string
  eventsPath: string
  cwd: string
  source: string
  templateId: string | null
  scheduleId: string | null
  scheduled: boolean
}

export interface TaskEvent {
  timestamp: string
  type: string
  [key: string]: unknown
}

export interface ScheduleRecord {
  id: string
  prompt: string
  everyMinutes: number
  status: ScheduleStatus
  createdAt: string
  updatedAt: string
  nextRunAt: string | null
  lastRunAt: string | null
  lastTaskId: string | null
  pid?: number
  cwd: string
  source: string
  templateId: string | null
  metadataPath: string
  eventsPath: string
}

export interface ScheduleEvent {
  timestamp: string
  type: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Command result
// ---------------------------------------------------------------------------

export interface CommandResult {
  exitCode: number
  output?: string
}
