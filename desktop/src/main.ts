import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

type Screen =
  | "inbox"
  | "running"
  | "new"
  | "providers"
  | "costs"
  | "vault";

type TaskStatus = "running" | "completed" | "failed";

type TaskRecord = {
  id: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  completedAt?: string;
  exitCode?: number;
  pid?: number;
  output?: string;
  cwd?: string;
  templateId?: string | null;
  scheduleId?: string | null;
  metadataPath?: string;
  eventsPath?: string;
  artifactDir?: string;
  outputArtifactPath?: string;
  summaryArtifactPath?: string;
  vaultNotePath?: string;
};

type TasksPayload = {
  tasks: TaskRecord[];
};

type TaskEvent = {
  timestamp: string;
  type: string;
  [key: string]: unknown;
};

type TaskEventsPayload = {
  taskId: string;
  events: TaskEvent[];
};

type ProvidersPayload = {
  configured?: boolean;
  activeProvider?: string;
  activeModel?: string;
  providers?: Array<Record<string, unknown>>;
};

type CostsPayload = {
  totalCost?: number;
  totalRequests?: number;
  byProvider?: Record<string, number>;
};

type TaskTemplate = {
  id: string;
  title: string;
  description: string;
  prompt: string;
};

type TaskTemplatesPayload = {
  templates: TaskTemplate[];
};

type ScheduleRecord = {
  id: string;
  prompt: string;
  everyMinutes: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastTaskId?: string | null;
  pid?: number;
};

type SchedulesPayload = {
  schedules: ScheduleRecord[];
};

type VaultNote = {
  path: string;
  title: string;
  preview: string;
  updatedAt?: string | null;
};

type VaultNotesPayload = {
  notes: VaultNote[];
};

type RuntimeStatus = {
  cliPath: string;
  configPath: string;
  configExists: boolean;
  providerCount: number;
  activeProvider?: string | null;
  activeModel?: string | null;
  jobsPath: string;
  tasksPath: string;
  schedulesPath: string;
  artifactsPath: string;
  vaultPath: string;
  taskCount: number;
  scheduleCount: number;
  voiceReady: boolean;
  voiceMissing: string[];
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root");
}

const screenLabels: Array<{ id: Screen; label: string; icon: string }> = [
  { id: "inbox", label: "Inbox/Review", icon: "📥" },
  { id: "running", label: "Running Tasks", icon: "🚀" },
  { id: "new", label: "New Task", icon: "➕" },
  { id: "providers", label: "Providers & Runtime", icon: "📡" },
  { id: "costs", label: "Usage / Cost", icon: "💸" },
  { id: "vault", label: "Memory Vault", icon: "🧠" },
];

const state = {
  screen: "running" as Screen,
  version: "loading…",
  tasks: [] as TaskRecord[],
  schedules: [] as ScheduleRecord[],
  templates: [] as TaskTemplate[],
  vaultNotes: [] as VaultNote[],
  selectedTaskId: null as string | null,
  selectedTask: null as TaskRecord | null,
  selectedTaskEvents: [] as TaskEvent[],
  providers: null as ProvidersPayload | null,
  costs: null as CostsPayload | null,
  runtime: null as RuntimeStatus | null,
  newTaskPrompt: "",
  scheduleEveryMinutes: "60",
  busy: false,
  error: "",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value?: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatRelative(value?: string): string {
  if (!value) return "—";
  const deltaMs = Date.now() - new Date(value).getTime();
  if (deltaMs < 60_000) return `${Math.max(1, Math.round(deltaMs / 1000))}s ago`;
  if (deltaMs < 3_600_000) return `${Math.round(deltaMs / 60_000)}m ago`;
  if (deltaMs < 86_400_000) return `${Math.round(deltaMs / 3_600_000)}h ago`;
  return `${Math.round(deltaMs / 86_400_000)}d ago`;
}

function formatDuration(task: TaskRecord): string {
  const end = task.completedAt ? new Date(task.completedAt).getTime() : Date.now();
  const start = new Date(task.createdAt).getTime();
  const deltaMs = Math.max(0, end - start);
  if (deltaMs < 1_000) return `${deltaMs}ms`;
  if (deltaMs < 60_000) return `${(deltaMs / 1_000).toFixed(1)}s`;
  return `${Math.floor(deltaMs / 60_000)}m ${Math.floor((deltaMs % 60_000) / 1_000)}s`;
}

function statusTone(status: TaskStatus): string {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

function invokeSafe<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

async function loadVersion(): Promise<void> {
  state.version = await invokeSafe<string>("get_version");
}

async function loadTasks(): Promise<void> {
  const payload = await invokeSafe<TasksPayload>("list_tasks");
  state.tasks = payload.tasks ?? [];
  if (!state.selectedTaskId && state.tasks.length > 0) {
    state.selectedTaskId = state.tasks[0]!.id;
  }
}

async function loadTaskDetails(taskId: string | null): Promise<void> {
  if (!taskId) {
    state.selectedTask = null;
    state.selectedTaskEvents = [];
    return;
  }
  state.selectedTask = await invokeSafe<TaskRecord>("resume_task", { taskId });
  const eventsPayload = await invokeSafe<TaskEventsPayload>("load_task_events", { taskId });
  state.selectedTaskEvents = eventsPayload.events ?? [];
}

async function loadProviders(): Promise<void> {
  state.providers = await invokeSafe<ProvidersPayload>("get_providers");
}

async function loadCosts(): Promise<void> {
  state.costs = await invokeSafe<CostsPayload>("get_costs");
}

async function loadTemplates(): Promise<void> {
  const payload = await invokeSafe<TaskTemplatesPayload>("list_task_templates");
  state.templates = payload.templates ?? [];
}

async function loadSchedules(): Promise<void> {
  const payload = await invokeSafe<SchedulesPayload>("list_schedules");
  state.schedules = payload.schedules ?? [];
}

async function loadVaultNotes(): Promise<void> {
  const payload = await invokeSafe<VaultNotesPayload>("list_vault_notes");
  state.vaultNotes = payload.notes ?? [];
}

async function loadRuntime(): Promise<void> {
  state.runtime = await invokeSafe<RuntimeStatus>("get_runtime_status");
}

async function refreshCurrentScreen(): Promise<void> {
  await loadTasks();
  if (state.screen === "inbox") {
    const completedOrFailed = state.tasks.filter(task => task.status !== "running");
    if (!state.selectedTaskId && completedOrFailed.length > 0) {
      state.selectedTaskId = completedOrFailed[0]!.id;
    }
    await loadTaskDetails(state.selectedTaskId);
  } else if (state.screen === "running") {
    await loadSchedules();
    const currentRunning = state.tasks.filter(task => task.status === "running");
    if (currentRunning.length > 0 && !state.selectedTaskId) {
      state.selectedTaskId = currentRunning[0]!.id;
    }
    const selectedRunningTask = currentRunning.find(task => task.id === state.selectedTaskId);
    if (selectedRunningTask) {
      await loadTaskDetails(selectedRunningTask.id);
    }
  } else if (state.screen === "new") {
    await Promise.all([loadTemplates(), loadSchedules()]);
  } else if (state.screen === "providers") {
    await Promise.all([loadProviders(), loadRuntime()]);
  } else if (state.screen === "costs") {
    await loadCosts();
  } else if (state.screen === "vault") {
    await Promise.all([loadRuntime(), loadVaultNotes()]);
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
  ]);
  const completedOrFailed = state.tasks.find(task => task.status !== "running");
  if (completedOrFailed) {
    state.selectedTaskId = completedOrFailed.id;
    state.selectedTask = completedOrFailed;
    await loadTaskDetails(completedOrFailed.id);
  }
  render();
}

function withBusy<T>(work: () => Promise<T>): Promise<T> {
  state.busy = true;
  state.error = "";
  render();
  return work()
    .catch((error: unknown) => {
      state.error = error instanceof Error ? error.message : String(error);
      render();
      throw error;
    })
    .finally(() => {
      state.busy = false;
      render();
    });
}

async function runTask(prompt: string): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  await withBusy(async () => {
    const task = await invokeSafe<TaskRecord>("run_task", { prompt: trimmed });
    state.newTaskPrompt = "";
    await loadTasks();
    state.screen = "running";
    state.selectedTaskId = task.id;
  });
}

async function cancelTask(taskId: string): Promise<void> {
  await withBusy(async () => {
    await invokeSafe("cancel_task", { taskId });
    await loadTasks();
    if (state.selectedTaskId === taskId) {
      await loadTaskDetails(taskId);
    }
  });
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
    ]);
    if (state.selectedTaskId) {
      await loadTaskDetails(state.selectedTaskId);
    }
  });
}

async function runTaskTemplate(templateId: string): Promise<void> {
  await withBusy(async () => {
    const task = await invokeSafe<TaskRecord>("run_task_template", { templateId });
    await Promise.all([loadTasks(), loadSchedules()]);
    state.screen = "running";
    state.selectedTaskId = task.id;
  });
}

async function runSchedule(prompt: string, templateId?: string): Promise<void> {
  const everyMinutes = Number(state.scheduleEveryMinutes);
  if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) {
    state.error = "Schedule interval must be a positive number of minutes.";
    render();
    return;
  }

  await withBusy(async () => {
    await invokeSafe<ScheduleRecord>("run_schedule", {
      prompt: prompt.trim(),
      everyMinutes,
      templateId,
    });
    await Promise.all([loadSchedules(), loadRuntime()]);
    state.screen = "running";
  });
}

async function cancelSchedule(scheduleId: string): Promise<void> {
  await withBusy(async () => {
    await invokeSafe("cancel_schedule", { scheduleId });
    await Promise.all([loadSchedules(), loadRuntime()]);
  });
}

async function pollActiveScreen(): Promise<void> {
  if (state.busy) return;
  if (state.screen !== "running" && state.screen !== "inbox") return;
  try {
    await refreshCurrentScreen();
    render();
  } catch (error: unknown) {
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

function renderTopBar(): string {
  const runtimeLabel = state.runtime?.configExists
    ? `${state.runtime.providerCount} provider${state.runtime.providerCount === 1 ? "" : "s"}`
    : "no config";
  return `
    <header class="topbar">
      <div>
        <div class="topbar-title">FreeClaude Desktop</div>
        <div class="topbar-subtitle">Local-first command center · desktop alpha</div>
      </div>
      <div class="topbar-meta">
        <span class="pill">${escapeHtml(state.version)}</span>
        <span class="pill muted">${escapeHtml(runtimeLabel)}</span>
        <button class="button secondary" data-action="refresh-all">Refresh</button>
      </div>
    </header>
  `;
}

function renderSidebar(): string {
  return `
    <aside class="sidebar">
      <div class="sidebar-group-label">Workspace</div>
      ${screenLabels
        .map(
          screen => `
            <button class="nav-item ${state.screen === screen.id ? "active" : ""}" data-action="switch-screen" data-screen="${screen.id}">
              <span>${screen.icon}</span>
              <span>${screen.label}</span>
            </button>
          `,
        )
        .join("")}
      <div class="sidebar-footer">
        <div class="footer-label">Task registry</div>
        <div class="footer-path">${escapeHtml(state.runtime?.tasksPath ?? "~/.freeclaude/tasks")}</div>
      </div>
    </aside>
  `;
}

function renderInbox(): string {
  const reviewTasks = state.tasks.filter(task => task.status !== "running");
  const selectedTask =
    state.selectedTask && state.selectedTask.id === state.selectedTaskId
      ? state.selectedTask
      : reviewTasks.find(task => task.id === state.selectedTaskId) ?? reviewTasks[0] ?? null;

  const eventsMarkup =
    selectedTask && state.selectedTaskId === selectedTask.id
      ? state.selectedTaskEvents
          .map(
            event => `
              <li class="event-item">
                <div class="event-type">${escapeHtml(event.type)}</div>
                <div class="event-meta">${escapeHtml(formatDate(String(event.timestamp)))}</div>
              </li>
            `,
          )
          .join("")
      : "";

  return `
    <section class="screen">
      <div class="screen-header">
        <div>
          <h2>Inbox / Review</h2>
          <p>Completed and failed tasks ready for inspection.</p>
        </div>
        <button class="button secondary" data-action="refresh-screen">Refresh</button>
      </div>
      <div class="review-layout">
        <div class="review-list">
          ${
            reviewTasks.length === 0
              ? `<div class="empty-state">No completed tasks yet. Start one from <strong>New Task</strong>.</div>`
              : reviewTasks
                  .map(
                    task => `
                      <button class="task-row ${task.id === selectedTask?.id ? "selected" : ""}" data-action="select-task" data-task-id="${task.id}">
                        <div class="task-row-top">
                          <span class="status-chip ${statusTone(task.status)}">${task.status}</span>
                          <span class="task-id">${task.id}</span>
                        </div>
                        <div class="task-prompt">${escapeHtml(task.prompt)}</div>
                        <div class="task-meta">${escapeHtml(formatDate(task.completedAt ?? task.createdAt))}</div>
                      </button>
                    `,
                  )
                  .join("")
          }
        </div>
        <div class="review-detail">
          ${
            !selectedTask
              ? `<div class="empty-state">Select a task to inspect output and structured events.</div>`
              : `
                <div class="card">
                  <div class="card-title-row">
                    <h3>${escapeHtml(selectedTask.prompt)}</h3>
                    <span class="status-chip ${statusTone(selectedTask.status)}">${selectedTask.status}</span>
                  </div>
                   <dl class="detail-grid">
                     <div><dt>Task ID</dt><dd>${escapeHtml(selectedTask.id)}</dd></div>
                     <div><dt>Created</dt><dd>${escapeHtml(formatDate(selectedTask.createdAt))}</dd></div>
                     <div><dt>Completed</dt><dd>${escapeHtml(formatDate(selectedTask.completedAt))}</dd></div>
                     <div><dt>Duration</dt><dd>${escapeHtml(formatDuration(selectedTask))}</dd></div>
                     <div><dt>Workspace</dt><dd>${escapeHtml(selectedTask.cwd ?? "—")}</dd></div>
                     <div><dt>Template</dt><dd>${escapeHtml(selectedTask.templateId ?? "—")}</dd></div>
                   </dl>
                 </div>
                <div class="card">
                  <h3>Output</h3>
                  <pre class="code-block">${escapeHtml(selectedTask.output ?? "(no output captured)")}</pre>
                </div>
                <div class="card">
                  <h3>Artifacts & vault</h3>
                  <dl class="detail-grid">
                    <div><dt>Artifact dir</dt><dd>${escapeHtml(selectedTask.artifactDir ?? "—")}</dd></div>
                    <div><dt>Output artifact</dt><dd>${escapeHtml(selectedTask.outputArtifactPath ?? "—")}</dd></div>
                    <div><dt>Task metadata</dt><dd>${escapeHtml(selectedTask.summaryArtifactPath ?? "—")}</dd></div>
                    <div><dt>Vault note</dt><dd>${escapeHtml(selectedTask.vaultNotePath ?? "—")}</dd></div>
                  </dl>
                </div>
                <div class="card">
                  <h3>Structured events</h3>
                  ${
                    eventsMarkup
                      ? `<ul class="event-list">${eventsMarkup}</ul>`
                      : `<div class="empty-state">No events recorded.</div>`
                  }
                </div>
              `
          }
        </div>
      </div>
    </section>
  `;
}

function renderRunningTasks(): string {
  const runningTasks = state.tasks.filter(task => task.status === "running");
  const recentTasks = state.tasks.slice(0, 8);
  const schedules = state.schedules.slice(0, 8);
  const selectedRunningTask =
    state.selectedTask && state.selectedTask.status === "running"
      ? state.selectedTask
      : runningTasks.find(task => task.id === state.selectedTaskId) ?? null;
  const liveEvents = state.selectedTaskEvents.slice(-8).reverse();

  return `
    <section class="screen">
      <div class="screen-header">
        <div>
          <h2>Running Tasks</h2>
          <p>Track local background agents and inspect recent task metadata.</p>
        </div>
        <button class="button secondary" data-action="refresh-screen">Refresh</button>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><span class="stat-value">${runningTasks.length}</span><span class="stat-label">Running</span></div>
        <div class="stat-card"><span class="stat-value">${state.tasks.filter(task => task.status === "completed").length}</span><span class="stat-label">Completed</span></div>
        <div class="stat-card"><span class="stat-value">${state.tasks.filter(task => task.status === "failed").length}</span><span class="stat-label">Failed</span></div>
      </div>
      <div class="card-stack">
        ${
          runningTasks.length === 0
            ? `<div class="empty-state">No running tasks right now. Launch one from <strong>New Task</strong>.</div>`
            : runningTasks
                .map(
                  task => `
                    <div class="card">
                      <div class="card-title-row">
                        <h3>${escapeHtml(task.prompt)}</h3>
                        <span class="status-chip running">${task.status}</span>
                      </div>
                      <div class="task-meta-row">
                        <span>ID ${escapeHtml(task.id)}</span>
                        <span>PID ${escapeHtml(String(task.pid ?? "—"))}</span>
                        <span>${escapeHtml(formatRelative(task.createdAt))}</span>
                      </div>
                      <div class="button-row">
                        <button class="button danger" data-action="cancel-task" data-task-id="${task.id}">Cancel</button>
                        <button class="button secondary" data-action="select-running-task" data-task-id="${task.id}">Inspect live output</button>
                      </div>
                    </div>
                  `,
                )
                .join("")
        }
      </div>
      ${
        selectedRunningTask
          ? `
            <div class="card">
              <div class="card-title-row">
                <h3>Live output · ${escapeHtml(selectedRunningTask.id)}</h3>
                <span class="status-chip running">running</span>
              </div>
              <pre class="code-block">${escapeHtml(selectedRunningTask.output ?? "(waiting for output)")}</pre>
              <h3>Recent events</h3>
              ${
                liveEvents.length > 0
                  ? `<ul class="event-list">
                      ${liveEvents
                        .map(
                          event => `
                            <li class="event-item">
                              <div class="event-type">${escapeHtml(event.type)}</div>
                              <div class="event-meta">${escapeHtml(formatDate(String(event.timestamp)))}</div>
                            </li>
                          `,
                        )
                        .join("")}
                    </ul>`
                  : `<div class="empty-state">No structured events yet.</div>`
              }
            </div>
          `
          : ""
      }
      <div class="card">
        <div class="card-title-row">
          <h3>Scheduled tasks</h3>
          <span class="status-chip ${schedules.some(schedule => schedule.status === "running") ? "running" : "completed"}">${schedules.length}</span>
        </div>
        ${
          schedules.length === 0
            ? `<div class="empty-state">No recurring schedules yet. Create one from <strong>New Task</strong>.</div>`
            : `<div class="card-stack">
                ${schedules
                  .map(
                    schedule => `
                      <div class="task-table-row">
                        <span class="status-chip ${schedule.status === "running" ? "running" : "failed"}">${escapeHtml(schedule.status)}</span>
                        <span class="task-id">${escapeHtml(schedule.id)}</span>
                        <span class="task-prompt compact">${escapeHtml(schedule.prompt)}</span>
                        <span>every ${escapeHtml(String(schedule.everyMinutes))}m</span>
                        <span>${escapeHtml(formatDate(schedule.nextRunAt ?? undefined))}</span>
                        ${
                          schedule.status === "running"
                            ? `<button class="button danger" data-action="cancel-schedule" data-schedule-id="${schedule.id}">Cancel</button>`
                            : ""
                        }
                      </div>
                    `,
                  )
                  .join("")}
              </div>`
        }
      </div>
      <div class="card">
        <h3>Recent tasks</h3>
        <div class="task-table">
          ${recentTasks
            .map(
              task => `
                <div class="task-table-row">
                  <span class="status-chip ${statusTone(task.status)}">${task.status}</span>
                  <span class="task-id">${escapeHtml(task.id)}</span>
                  <span class="task-prompt compact">${escapeHtml(task.prompt)}</span>
                  <span>${escapeHtml(formatDuration(task))}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function renderNewTask(): string {
  return `
    <section class="screen">
      <div class="screen-header">
        <div>
          <h2>New Task</h2>
          <p>Launch a local background task through the new machine-readable task protocol.</p>
        </div>
      </div>
      <div class="card">
        <label class="field-label" for="newTaskPrompt">Prompt</label>
        <textarea id="newTaskPrompt" class="task-textarea" data-role="new-task-prompt" placeholder="e.g. review the current repository changes and summarize risks">${escapeHtml(state.newTaskPrompt)}</textarea>
        <div class="field-row">
          <div class="field-inline">
            <label class="field-label" for="scheduleEveryMinutes">Recurring interval (minutes)</label>
            <input id="scheduleEveryMinutes" class="small-input" data-role="schedule-interval" value="${escapeHtml(state.scheduleEveryMinutes)}" />
          </div>
          <div class="subtle-note">Schedules start immediately and then repeat on the chosen interval.</div>
        </div>
        <div class="button-row">
          <button class="button primary" data-action="run-task" ${state.busy ? "disabled" : ""}>Start task</button>
          <button class="button secondary" data-action="schedule-task" ${state.busy ? "disabled" : ""}>Schedule recurring task</button>
          <button class="button secondary" data-action="clear-task-prompt">Clear</button>
        </div>
      </div>
      <div class="card">
        <h3>Built-in task templates</h3>
        <div class="template-grid">
          ${state.templates
            .map(
              template => `
                <div class="template-card">
                  <div class="provider-name">${escapeHtml(template.title)}</div>
                  <div class="task-meta">${escapeHtml(template.id)}</div>
                  <p class="card-text">${escapeHtml(template.description)}</p>
                  <div class="button-row">
                    <button class="button secondary" data-action="use-template" data-template="${escapeHtml(template.prompt)}">Use prompt</button>
                    <button class="button primary" data-action="run-template" data-template-id="${template.id}">Run now</button>
                    <button class="button secondary" data-action="schedule-template" data-template-id="${template.id}">Schedule</button>
                  </div>
                </div>
              `,
            )
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function renderProviders(): string {
  const providers = state.providers?.providers ?? [];
  return `
    <section class="screen">
      <div class="screen-header">
        <div>
          <h2>Providers & Runtime</h2>
          <p>Current CLI version, configured providers, runtime readiness, and voice diagnostics.</p>
        </div>
        <button class="button secondary" data-action="refresh-screen">Refresh</button>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><span class="stat-value">${escapeHtml(state.version)}</span><span class="stat-label">CLI version</span></div>
        <div class="stat-card"><span class="stat-value">${state.runtime?.providerCount ?? 0}</span><span class="stat-label">Configured providers</span></div>
        <div class="stat-card"><span class="stat-value">${state.runtime?.scheduleCount ?? 0}</span><span class="stat-label">Schedules</span></div>
        <div class="stat-card"><span class="stat-value">${state.runtime?.voiceReady ? "ready" : "optional"}</span><span class="stat-label">Voice mode</span></div>
      </div>
      <div class="card">
        <h3>Runtime</h3>
        <dl class="detail-grid">
          <div><dt>CLI path</dt><dd>${escapeHtml(state.runtime?.cliPath ?? "—")}</dd></div>
          <div><dt>Config path</dt><dd>${escapeHtml(state.runtime?.configPath ?? "—")}</dd></div>
          <div><dt>Tasks path</dt><dd>${escapeHtml(state.runtime?.tasksPath ?? "—")}</dd></div>
          <div><dt>Schedules path</dt><dd>${escapeHtml(state.runtime?.schedulesPath ?? "—")}</dd></div>
          <div><dt>Artifacts path</dt><dd>${escapeHtml(state.runtime?.artifactsPath ?? "—")}</dd></div>
          <div><dt>Vault path</dt><dd>${escapeHtml(state.runtime?.vaultPath ?? "—")}</dd></div>
        </dl>
        ${
          state.runtime && !state.runtime.voiceReady
            ? `<div class="notice warning">Voice is optional right now: ${escapeHtml(state.runtime.voiceMissing.join(", "))}</div>`
            : `<div class="notice success">Voice runtime looks ready.</div>`
        }
      </div>
      <div class="card">
        <h3>Configured providers</h3>
        ${
          providers.length === 0
            ? `<div class="empty-state">No providers configured yet. Run <code>freeclaude --setup</code>.</div>`
            : `<div class="provider-grid">
                ${providers
                  .map(provider => {
                    const name = String(provider.name ?? "unknown");
                    const model = String(provider.model ?? "unknown");
                    const apiKey = String(provider.apiKey ?? "—");
                    return `
                      <div class="provider-card">
                        <div class="provider-name">${escapeHtml(name)}</div>
                        <div class="provider-model">${escapeHtml(model)}</div>
                        <div class="provider-key">${escapeHtml(apiKey)}</div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>`
        }
      </div>
    </section>
  `;
}

function renderCosts(): string {
  const byProvider = state.costs?.byProvider ?? {};
  const providerRows = Object.entries(byProvider).sort((a, b) => b[1] - a[1]);

  return `
    <section class="screen">
      <div class="screen-header">
        <div>
          <h2>Usage / Cost</h2>
          <p>Track request volume and provider cost rollups from the local CLI telemetry files.</p>
        </div>
        <button class="button secondary" data-action="refresh-screen">Refresh</button>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><span class="stat-value">$${(state.costs?.totalCost ?? 0).toFixed(4)}</span><span class="stat-label">Total cost</span></div>
        <div class="stat-card"><span class="stat-value">${state.costs?.totalRequests ?? 0}</span><span class="stat-label">Requests</span></div>
        <div class="stat-card"><span class="stat-value">${providerRows.length}</span><span class="stat-label">Providers used</span></div>
      </div>
      <div class="card">
        <h3>By provider</h3>
        ${
          providerRows.length === 0
            ? `<div class="empty-state">No local cost data recorded yet.</div>`
            : `<div class="task-table">
                ${providerRows
                  .map(
                    ([provider, value]) => `
                      <div class="task-table-row">
                        <span class="provider-name">${escapeHtml(provider)}</span>
                        <span>$${value.toFixed(4)}</span>
                      </div>
                    `,
                  )
                  .join("")}
              </div>`
        }
      </div>
    </section>
  `;
}

function renderVault(): string {
  return `
    <section class="screen">
      <div class="screen-header">
        <div>
          <h2>Memory Vault</h2>
          <p>Current local paths for the inspectable developer vault and task artifacts.</p>
        </div>
        <button class="button secondary" data-action="refresh-screen">Refresh</button>
      </div>
      <div class="card-stack">
        <div class="card">
          <h3>Planned source of truth</h3>
          <p class="card-text">
            The roadmap keeps memory file-based and inspectable. This desktop shell now exposes the core local paths that the next vault work will build on.
          </p>
          <dl class="detail-grid">
            <div><dt>Vault path</dt><dd>${escapeHtml(state.runtime?.vaultPath ?? "—")}</dd></div>
            <div><dt>Tasks path</dt><dd>${escapeHtml(state.runtime?.tasksPath ?? "—")}</dd></div>
            <div><dt>Artifacts path</dt><dd>${escapeHtml(state.runtime?.artifactsPath ?? "—")}</dd></div>
            <div><dt>Schedules path</dt><dd>${escapeHtml(state.runtime?.schedulesPath ?? "—")}</dd></div>
            <div><dt>Jobs path</dt><dd>${escapeHtml(state.runtime?.jobsPath ?? "—")}</dd></div>
          </dl>
        </div>
        <div class="card">
          <h3>What already exists</h3>
          <ul class="bullet-list">
            <li>Structured task metadata in <code>task.json</code></li>
            <li>Structured local task events in <code>events.jsonl</code></li>
            <li>Compatibility with the existing <code>~/.freeclaude/jobs</code> registry</li>
          </ul>
        </div>
        <div class="card">
          <h3>Recent vault notes</h3>
          ${
            state.vaultNotes.length === 0
              ? `<div class="empty-state">No vault notes yet. Completed tasks will write Markdown notes here automatically.</div>`
              : `<div class="task-table">
                  ${state.vaultNotes
                    .map(
                      note => `
                        <div class="event-item">
                          <div class="event-type">${escapeHtml(note.title)}</div>
                          <div class="event-meta">${escapeHtml(note.path)}</div>
                          <div class="task-meta">${escapeHtml(note.preview || "(no preview)")}</div>
                        </div>
                      `,
                    )
                    .join("")}
                </div>`
          }
        </div>
      </div>
    </section>
  `;
}

function renderMainContent(): string {
  switch (state.screen) {
    case "inbox":
      return renderInbox();
    case "running":
      return renderRunningTasks();
    case "new":
      return renderNewTask();
    case "providers":
      return renderProviders();
    case "costs":
      return renderCosts();
    case "vault":
      return renderVault();
  }
}

function render(): void {
  app!.innerHTML = `
    <div class="shell">
      ${renderSidebar()}
      <main class="main-panel">
        ${renderTopBar()}
        ${state.error ? `<div class="notice error">${escapeHtml(state.error)}</div>` : ""}
        ${state.busy ? `<div class="busy-banner">Working…</div>` : ""}
        ${renderMainContent()}
      </main>
    </div>
  `;
}

document.addEventListener("click", event => {
  const target = event.target as HTMLElement | null;
  const actionEl = target?.closest<HTMLElement>("[data-action]");
  if (!actionEl) return;

  const action = actionEl.dataset.action;
  if (!action) return;

  void (async () => {
    switch (action) {
      case "switch-screen": {
        const nextScreen = actionEl.dataset.screen as Screen | undefined;
        if (!nextScreen) return;
        state.screen = nextScreen;
        render();
        await withBusy(refreshCurrentScreen);
        break;
      }
      case "refresh-all":
        await refreshAll();
        break;
      case "refresh-screen":
        await withBusy(refreshCurrentScreen);
        break;
      case "run-task":
        await runTask(state.newTaskPrompt);
        break;
      case "schedule-task":
        await runSchedule(state.newTaskPrompt);
        break;
      case "clear-task-prompt":
        state.newTaskPrompt = "";
        render();
        break;
      case "use-template":
        state.newTaskPrompt = actionEl.dataset.template ?? "";
        render();
        break;
      case "run-template": {
        const templateId = actionEl.dataset.templateId;
        if (!templateId) return;
        await runTaskTemplate(templateId);
        break;
      }
      case "schedule-template": {
        const templateId = actionEl.dataset.templateId;
        if (!templateId) return;
        await runSchedule("", templateId);
        break;
      }
      case "cancel-task": {
        const taskId = actionEl.dataset.taskId;
        if (!taskId) return;
        await cancelTask(taskId);
        break;
      }
      case "cancel-schedule": {
        const scheduleId = actionEl.dataset.scheduleId;
        if (!scheduleId) return;
        await cancelSchedule(scheduleId);
        break;
      }
      case "select-task": {
        const taskId = actionEl.dataset.taskId;
        if (!taskId) return;
        state.selectedTaskId = taskId;
        state.screen = "inbox";
        render();
        await withBusy(async () => {
          await loadTaskDetails(taskId);
        });
        break;
      }
      case "select-running-task": {
        const taskId = actionEl.dataset.taskId;
        if (!taskId) return;
        state.selectedTaskId = taskId;
        state.screen = "running";
        render();
        await withBusy(async () => {
          await loadTaskDetails(taskId);
        });
        break;
      }
      case "select-screen-and-task": {
        const taskId = actionEl.dataset.taskId;
        const screen = actionEl.dataset.screen as Screen | undefined;
        if (!taskId || !screen) return;
        state.selectedTaskId = taskId;
        state.screen = screen;
        render();
        await withBusy(async () => {
          await loadTaskDetails(taskId);
        });
        break;
      }
    }
  })();
});

document.addEventListener("input", event => {
  const target = event.target as HTMLTextAreaElement | HTMLInputElement | null;
  if (!target) return;
  if (target.matches("[data-role='new-task-prompt']")) {
    state.newTaskPrompt = target.value;
  }
  if (target.matches("[data-role='schedule-interval']")) {
    state.scheduleEveryMinutes = target.value;
  }
});

window.setInterval(() => {
  void pollActiveScreen();
}, 5000);

void bootstrap().catch((error: unknown) => {
  state.error = error instanceof Error ? error.message : String(error);
  render();
});
