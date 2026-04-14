import { invoke } from '@tauri-apps/api/core'
import type {
  CostsPayload,
  ProvidersPayload,
  RuntimeStatus,
  ScheduleRecord,
  SchedulesPayload,
  TaskEventsPayload,
  TaskRecord,
  TaskTemplatesPayload,
  TasksPayload,
  VaultNotesPayload,
} from './types'

function invokeSafe<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, args)
}

export function getVersion(): Promise<string> {
  return invokeSafe<string>('get_version')
}

export function listTasks(): Promise<TasksPayload> {
  return invokeSafe<TasksPayload>('list_tasks')
}

export function getTaskRecord(taskId: string): Promise<TaskRecord> {
  return invokeSafe<TaskRecord>('resume_task', { taskId })
}

export function getTaskEvents(taskId: string): Promise<TaskEventsPayload> {
  return invokeSafe<TaskEventsPayload>('load_task_events', { taskId })
}

export function getProviders(): Promise<ProvidersPayload> {
  return invokeSafe<ProvidersPayload>('get_providers')
}

export function getCosts(): Promise<CostsPayload> {
  return invokeSafe<CostsPayload>('get_costs')
}

export function listTaskTemplates(): Promise<TaskTemplatesPayload> {
  return invokeSafe<TaskTemplatesPayload>('list_task_templates')
}

export function listSchedules(): Promise<SchedulesPayload> {
  return invokeSafe<SchedulesPayload>('list_schedules')
}

export function listVaultNotes(): Promise<VaultNotesPayload> {
  return invokeSafe<VaultNotesPayload>('list_vault_notes')
}

export function getRuntimeStatus(): Promise<RuntimeStatus> {
  return invokeSafe<RuntimeStatus>('get_runtime_status')
}

export function runTask(prompt: string): Promise<TaskRecord> {
  return invokeSafe<TaskRecord>('run_task', { prompt })
}

export function cancelTask(taskId: string): Promise<void> {
  return invokeSafe<void>('cancel_task', { taskId })
}

export function runTaskTemplate(templateId: string): Promise<TaskRecord> {
  return invokeSafe<TaskRecord>('run_task_template', { templateId })
}

export function runSchedule(
  prompt: string,
  everyMinutes: number,
  templateId?: string,
): Promise<ScheduleRecord> {
  return invokeSafe<ScheduleRecord>('run_schedule', {
    prompt,
    everyMinutes,
    templateId,
  })
}

export function cancelSchedule(scheduleId: string): Promise<void> {
  return invokeSafe<void>('cancel_schedule', { scheduleId })
}
