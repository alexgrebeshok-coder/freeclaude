export type Screen =
  | 'inbox'
  | 'running'
  | 'new'
  | 'providers'
  | 'costs'
  | 'vault'

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type TaskRecord = {
  id: string
  prompt: string
  status: TaskStatus
  createdAt: string
  completedAt?: string
  exitCode?: number
  pid?: number
  output?: string
  cwd?: string
  templateId?: string | null
  scheduleId?: string | null
  metadataPath?: string
  eventsPath?: string
  artifactDir?: string
  outputArtifactPath?: string
  summaryArtifactPath?: string
  vaultNotePath?: string
}

export type TasksPayload = {
  tasks: TaskRecord[]
}

export type TaskEvent = {
  timestamp: string
  type: string
  [key: string]: unknown
}

export type TaskEventsPayload = {
  taskId: string
  events: TaskEvent[]
}

export type ProvidersPayload = {
  configured?: boolean
  activeProvider?: string
  activeModel?: string
  providers?: Array<Record<string, unknown>>
}

export type CostsPayload = {
  totalCost?: number
  totalRequests?: number
  byProvider?: Record<string, number>
}

export type TaskTemplate = {
  id: string
  title: string
  description: string
  prompt: string
}

export type TaskTemplatesPayload = {
  templates: TaskTemplate[]
}

export type ScheduleRecord = {
  id: string
  prompt: string
  everyMinutes: number
  status: string
  createdAt: string
  updatedAt?: string
  nextRunAt?: string | null
  lastRunAt?: string | null
  lastTaskId?: string | null
  pid?: number
}

export type SchedulesPayload = {
  schedules: ScheduleRecord[]
}

export type VaultNote = {
  path: string
  title: string
  preview: string
  updatedAt?: string | null
}

export type VaultNotesPayload = {
  notes: VaultNote[]
}

export type RuntimeStatus = {
  cliPath: string
  configPath: string
  configExists: boolean
  providerCount: number
  activeProvider?: string | null
  activeModel?: string | null
  jobsPath: string
  tasksPath: string
  schedulesPath: string
  artifactsPath: string
  vaultPath: string
  taskCount: number
  scheduleCount: number
  voiceReady: boolean
  voiceMissing: string[]
}

export type DesktopState = {
  screen: Screen
  version: string
  tasks: TaskRecord[]
  schedules: ScheduleRecord[]
  templates: TaskTemplate[]
  vaultNotes: VaultNote[]
  selectedTaskId: string | null
  selectedTask: TaskRecord | null
  selectedTaskEvents: TaskEvent[]
  providers: ProvidersPayload | null
  costs: CostsPayload | null
  runtime: RuntimeStatus | null
  newTaskPrompt: string
  scheduleEveryMinutes: string
  busy: boolean
  error: string
}

export type ScreenLabel = {
  id: Screen
  label: string
  icon: string
}
