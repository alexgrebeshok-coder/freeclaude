import './styles.css'
import {
  cancelSchedule as cancelScheduleCommand,
  cancelTask as cancelTaskCommand,
  getCosts,
  getProviders,
  getRuntimeStatus,
  getTaskEvents,
  getTaskRecord,
  getVersion,
  listSchedules,
  listTaskTemplates,
  listTasks,
  listVaultNotes,
  runSchedule as runScheduleCommand,
  runTask as runTaskCommand,
  runTaskTemplate as runTaskTemplateCommand,
} from './ipc'
import { renderShell } from './screens'
import type { DesktopState, Screen } from './types'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Missing #app root')
}

const root = app

const state: DesktopState = {
  screen: 'running',
  version: 'loading…',
  tasks: [],
  schedules: [],
  templates: [],
  vaultNotes: [],
  selectedTaskId: null,
  selectedTask: null,
  selectedTaskEvents: [],
  providers: null,
  costs: null,
  runtime: null,
  newTaskPrompt: '',
  scheduleEveryMinutes: '60',
  busy: false,
  error: '',
}

async function loadVersion(): Promise<void> {
  state.version = await getVersion()
}

async function loadTasks(): Promise<void> {
  const payload = await listTasks()
  state.tasks = payload.tasks ?? []
  if (!state.selectedTaskId && state.tasks.length > 0) {
    state.selectedTaskId = state.tasks[0]!.id
  }
}

async function loadTaskDetails(taskId: string | null): Promise<void> {
  if (!taskId) {
    state.selectedTask = null
    state.selectedTaskEvents = []
    return
  }
  state.selectedTask = await getTaskRecord(taskId)
  const eventsPayload = await getTaskEvents(taskId)
  state.selectedTaskEvents = eventsPayload.events ?? []
}

async function loadProviders(): Promise<void> {
  state.providers = await getProviders()
}

async function loadCosts(): Promise<void> {
  state.costs = await getCosts()
}

async function loadTemplates(): Promise<void> {
  const payload = await listTaskTemplates()
  state.templates = payload.templates ?? []
}

async function loadSchedules(): Promise<void> {
  const payload = await listSchedules()
  state.schedules = payload.schedules ?? []
}

async function loadVaultNotes(): Promise<void> {
  const payload = await listVaultNotes()
  state.vaultNotes = payload.notes ?? []
}

async function loadRuntime(): Promise<void> {
  state.runtime = await getRuntimeStatus()
}

async function refreshCurrentScreen(): Promise<void> {
  await loadTasks()
  if (state.screen === 'inbox') {
    const completedOrFailed = state.tasks.filter(task => task.status !== 'running')
    if (!state.selectedTaskId && completedOrFailed.length > 0) {
      state.selectedTaskId = completedOrFailed[0]!.id
    }
    await loadTaskDetails(state.selectedTaskId)
  } else if (state.screen === 'running') {
    await loadSchedules()
    const currentRunning = state.tasks.filter(task => task.status === 'running')
    if (currentRunning.length > 0 && !state.selectedTaskId) {
      state.selectedTaskId = currentRunning[0]!.id
    }
    const selectedRunningTask = currentRunning.find(
      task => task.id === state.selectedTaskId,
    )
    if (selectedRunningTask) {
      await loadTaskDetails(selectedRunningTask.id)
    }
  } else if (state.screen === 'new') {
    await Promise.all([loadTemplates(), loadSchedules()])
  } else if (state.screen === 'providers') {
    await Promise.all([loadProviders(), loadRuntime()])
  } else if (state.screen === 'costs') {
    await loadCosts()
  } else if (state.screen === 'vault') {
    await Promise.all([loadRuntime(), loadVaultNotes()])
  }
}

async function bootstrap(): Promise<void> {
  await Promise.all([
    loadVersion(),
    loadTasks(),
    loadSchedules(),
    loadTemplates(),
    loadVaultNotes(),
    loadProviders(),
    loadCosts(),
    loadRuntime(),
  ])
  const completedOrFailed = state.tasks.find(task => task.status !== 'running')
  if (completedOrFailed) {
    state.selectedTaskId = completedOrFailed.id
    state.selectedTask = completedOrFailed
    await loadTaskDetails(completedOrFailed.id)
  }
  render()
}

function withBusy<T>(work: () => Promise<T>): Promise<T> {
  state.busy = true
  state.error = ''
  render()
  return work()
    .catch((error: unknown) => {
      state.error = error instanceof Error ? error.message : String(error)
      render()
      throw error
    })
    .finally(() => {
      state.busy = false
      render()
    })
}

async function runTask(prompt: string): Promise<void> {
  const trimmed = prompt.trim()
  if (!trimmed) return
  await withBusy(async () => {
    const task = await runTaskCommand(trimmed)
    state.newTaskPrompt = ''
    await loadTasks()
    state.screen = 'running'
    state.selectedTaskId = task.id
  })
}

async function cancelTask(taskId: string): Promise<void> {
  await withBusy(async () => {
    await cancelTaskCommand(taskId)
    await loadTasks()
    if (state.selectedTaskId === taskId) {
      await loadTaskDetails(taskId)
    }
  })
}

async function refreshAll(): Promise<void> {
  await withBusy(async () => {
    await Promise.all([
      loadTasks(),
      loadSchedules(),
      loadTemplates(),
      loadVaultNotes(),
      loadProviders(),
      loadCosts(),
      loadRuntime(),
    ])
    if (state.selectedTaskId) {
      await loadTaskDetails(state.selectedTaskId)
    }
  })
}

async function runTaskTemplate(templateId: string): Promise<void> {
  await withBusy(async () => {
    const task = await runTaskTemplateCommand(templateId)
    await Promise.all([loadTasks(), loadSchedules()])
    state.screen = 'running'
    state.selectedTaskId = task.id
  })
}

async function runSchedule(prompt: string, templateId?: string): Promise<void> {
  const everyMinutes = Number(state.scheduleEveryMinutes)
  if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) {
    state.error = 'Schedule interval must be a positive number of minutes.'
    render()
    return
  }

  await withBusy(async () => {
    await runScheduleCommand(prompt.trim(), everyMinutes, templateId)
    await Promise.all([loadSchedules(), loadRuntime()])
    state.screen = 'running'
  })
}

async function cancelSchedule(scheduleId: string): Promise<void> {
  await withBusy(async () => {
    await cancelScheduleCommand(scheduleId)
    await Promise.all([loadSchedules(), loadRuntime()])
  })
}

async function pollActiveScreen(): Promise<void> {
  if (state.busy) return
  if (state.screen !== 'running' && state.screen !== 'inbox') return
  try {
    await refreshCurrentScreen()
    render()
  } catch (error: unknown) {
    state.error = error instanceof Error ? error.message : String(error)
    render()
  }
}

function render(): void {
  root.innerHTML = renderShell(state)
}

document.addEventListener('click', event => {
  const target = event.target as HTMLElement | null
  const actionEl = target?.closest<HTMLElement>('[data-action]')
  if (!actionEl) return

  const action = actionEl.dataset.action
  if (!action) return

  void (async () => {
    switch (action) {
      case 'switch-screen': {
        const nextScreen = actionEl.dataset.screen as Screen | undefined
        if (!nextScreen) return
        state.screen = nextScreen
        render()
        await withBusy(refreshCurrentScreen)
        break
      }
      case 'refresh-all':
        await refreshAll()
        break
      case 'refresh-screen':
        await withBusy(refreshCurrentScreen)
        break
      case 'run-task':
        await runTask(state.newTaskPrompt)
        break
      case 'schedule-task':
        await runSchedule(state.newTaskPrompt)
        break
      case 'clear-task-prompt':
        state.newTaskPrompt = ''
        render()
        break
      case 'use-template':
        state.newTaskPrompt = actionEl.dataset.template ?? ''
        render()
        break
      case 'run-template': {
        const templateId = actionEl.dataset.templateId
        if (!templateId) return
        await runTaskTemplate(templateId)
        break
      }
      case 'schedule-template': {
        const templateId = actionEl.dataset.templateId
        if (!templateId) return
        await runSchedule('', templateId)
        break
      }
      case 'cancel-task': {
        const taskId = actionEl.dataset.taskId
        if (!taskId) return
        await cancelTask(taskId)
        break
      }
      case 'cancel-schedule': {
        const scheduleId = actionEl.dataset.scheduleId
        if (!scheduleId) return
        await cancelSchedule(scheduleId)
        break
      }
      case 'select-task': {
        const taskId = actionEl.dataset.taskId
        if (!taskId) return
        state.selectedTaskId = taskId
        state.screen = 'inbox'
        render()
        await withBusy(async () => {
          await loadTaskDetails(taskId)
        })
        break
      }
      case 'select-running-task': {
        const taskId = actionEl.dataset.taskId
        if (!taskId) return
        state.selectedTaskId = taskId
        state.screen = 'running'
        render()
        await withBusy(async () => {
          await loadTaskDetails(taskId)
        })
        break
      }
      case 'select-screen-and-task': {
        const taskId = actionEl.dataset.taskId
        const screen = actionEl.dataset.screen as Screen | undefined
        if (!taskId || !screen) return
        state.selectedTaskId = taskId
        state.screen = screen
        render()
        await withBusy(async () => {
          await loadTaskDetails(taskId)
        })
        break
      }
    }
  })()
})

document.addEventListener('input', event => {
  const target = event.target as HTMLTextAreaElement | HTMLInputElement | null
  if (!target) return
  if (target.matches("[data-role='new-task-prompt']")) {
    state.newTaskPrompt = target.value
  }
  if (target.matches("[data-role='schedule-interval']")) {
    state.scheduleEveryMinutes = target.value
  }
})

window.setInterval(() => {
  void pollActiveScreen()
}, 5000)

void bootstrap().catch((error: unknown) => {
  state.error = error instanceof Error ? error.message : String(error)
  render()
})
