import fs from "node:fs";
import path from "node:path";
import {
  loadPersistedRuns,
  loadPersistedSessions,
} from "./runtime-state.mjs";

const PM_STATE_FILE = "pm-state.json";

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function readPositiveNumber(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function ensureStateDir(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  return stateDir;
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, payload) {
  ensureStateDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function getPmStatePath(stateDir) {
  return path.join(ensureStateDir(stateDir), PM_STATE_FILE);
}

function normalizeContext({ sessionKey, workdir }) {
  return {
    sessionKey: readString(sessionKey),
    workdir: readString(workdir),
  };
}

function buildContextKey({ sessionKey, workdir }) {
  const normalized = normalizeContext({ sessionKey, workdir });
  return `${normalized.sessionKey || "-"}::${normalized.workdir || "-"}`;
}

function loadPmState(stateDir) {
  const payload = readJsonFile(getPmStatePath(stateDir), {
    version: 1,
    projectCounter: 0,
    taskCounter: 0,
    projects: [],
    tasks: [],
  });
  return {
    version: 1,
    projectCounter:
      typeof payload?.projectCounter === "number" && Number.isFinite(payload.projectCounter)
        ? payload.projectCounter
        : 0,
    taskCounter:
      typeof payload?.taskCounter === "number" && Number.isFinite(payload.taskCounter)
        ? payload.taskCounter
        : 0,
    projects: Array.isArray(payload?.projects) ? payload.projects : [],
    tasks: Array.isArray(payload?.tasks) ? payload.tasks : [],
  };
}

function savePmState(stateDir, state) {
  writeJsonFile(getPmStatePath(stateDir), {
    version: 1,
    updatedAt: Date.now(),
    projectCounter: state.projectCounter,
    taskCounter: state.taskCounter,
    projects: state.projects,
    tasks: state.tasks,
  });
}

export const PM_RESOURCE = {
  uri: "freeclaude://project-context",
  name: "FreeClaude Project Context",
  description:
    "Shared bidirectional project context: FreeClaude sessions, recent runs, PM items, and injected OpenClaw memory.",
  mimeType: "text/plain",
};

export const PM_TOOLS = [
  {
    name: "pm_project_create",
    description: "Create a project in the shared PM store. Optionally bind it to sessionKey/workdir for bidirectional MCP workflows.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name" },
        budget: { type: "number", description: "Budget in rubles" },
        startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
        endDate: { type: "string", description: "End date (YYYY-MM-DD, optional)" },
        workdir: { type: "string", description: "Optional shared workdir for this project context." },
        sessionKey: { type: "string", description: "Optional shared OpenClaw session key." },
      },
      required: ["name", "budget", "startDate"],
    },
  },
  {
    name: "pm_project_list",
    description: "List PM projects. Can be filtered by shared sessionKey/workdir context.",
    inputSchema: {
      type: "object",
      properties: {
        workdir: { type: "string" },
        sessionKey: { type: "string" },
      },
    },
  },
  {
    name: "pm_task_create",
    description: "Create a PM task inside a project. Shared context is inherited from the project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
        assignee: { type: "string" },
        estimatedHours: { type: "number" },
        dueDate: { type: "string" },
      },
      required: ["projectId", "title"],
    },
  },
  {
    name: "pm_task_update",
    description: "Update task status, spent hours, or assignee in the shared PM store.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        status: { type: "string", enum: ["todo", "in-progress", "review", "done"] },
        actualHours: { type: "number" },
        assignee: { type: "string" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "pm_evm",
    description: "Calculate EVM metrics for a PM project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        percentComplete: { type: "number", description: "Current % complete (0-100)" },
      },
      required: ["projectId", "percentComplete"],
    },
  },
  {
    name: "pm_status",
    description: "Get a PM project status report with context binding, tasks, progress, and budget info.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "freeclaude_project_context",
    description: "Return the shared bidirectional project context for a sessionKey/workdir pair.",
    inputSchema: {
      type: "object",
      properties: {
        sessionKey: { type: "string" },
        workdir: { type: "string" },
        runLimit: {
          type: "number",
          description: "Maximum recent runs to include (default: 5).",
        },
      },
    },
  },
];

export function isPmTool(name) {
  return PM_TOOLS.some((tool) => tool.name === name);
}

function filterProjectsByContext(projects, context) {
  if (!context.sessionKey && !context.workdir) {
    return projects;
  }
  return projects.filter((project) => {
    if (context.sessionKey && project.sessionKey !== context.sessionKey) {
      return false;
    }
    if (context.workdir && project.workdir !== context.workdir) {
      return false;
    }
    return true;
  });
}

function enrichProject(project, tasks) {
  const projectTasks = tasks.filter((task) => task.projectId === project.id);
  return {
    ...project,
    tasks: projectTasks,
  };
}

function handleProjectCreate(args, stateDir) {
  const state = loadPmState(stateDir);
  state.projectCounter += 1;

  const context = normalizeContext(args);
  const project = {
    id: `proj_${state.projectCounter.toString(36)}`,
    name: readString(args.name) || "Untitled",
    status: "planning",
    budget: readPositiveNumber(args.budget) || 0,
    spent: 0,
    startDate: readString(args.startDate) || new Date().toISOString().slice(0, 10),
    endDate: readString(args.endDate) || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionKey: context.sessionKey,
    workdir: context.workdir,
    contextKey: buildContextKey(context),
  };

  state.projects.push(project);
  savePmState(stateDir, state);

  return JSON.stringify(
    {
      success: true,
      project: {
        id: project.id,
        name: project.name,
        budget: project.budget,
        sessionKey: project.sessionKey || null,
        workdir: project.workdir || null,
      },
    },
    null,
    2,
  );
}

function handleProjectList(args, stateDir) {
  const state = loadPmState(stateDir);
  const context = normalizeContext(args);
  const projects = filterProjectsByContext(state.projects, context).map((project) => {
    const tasks = state.tasks.filter((task) => task.projectId === project.id);
    return {
      id: project.id,
      name: project.name,
      status: project.status,
      budget: project.budget,
      spent: project.spent,
      sessionKey: project.sessionKey || null,
      workdir: project.workdir || null,
      tasks: tasks.length,
      done: tasks.filter((task) => task.status === "done").length,
    };
  });

  return JSON.stringify({ total: projects.length, projects }, null, 2);
}

function handleTaskCreate(args, stateDir) {
  const state = loadPmState(stateDir);
  const project = state.projects.find((entry) => entry.id === readString(args.projectId));
  if (!project) {
    return JSON.stringify({ error: `Project not found: ${readString(args.projectId)}` });
  }

  state.taskCounter += 1;
  const task = {
    id: `task_${state.taskCounter.toString(36)}`,
    projectId: project.id,
    title: readString(args.title) || "Untitled",
    status: "todo",
    priority: ["low", "medium", "high", "critical"].includes(readString(args.priority))
      ? readString(args.priority)
      : "medium",
    assignee: readString(args.assignee) || undefined,
    estimatedHours: readPositiveNumber(args.estimatedHours),
    actualHours: undefined,
    dueDate: readString(args.dueDate) || undefined,
    sessionKey: project.sessionKey,
    workdir: project.workdir,
    contextKey: project.contextKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  state.tasks.push(task);
  project.updatedAt = new Date().toISOString();
  savePmState(stateDir, state);

  return JSON.stringify(
    {
      success: true,
      task: {
        id: task.id,
        title: task.title,
        priority: task.priority,
        sessionKey: task.sessionKey || null,
        workdir: task.workdir || null,
      },
    },
    null,
    2,
  );
}

function handleTaskUpdate(args, stateDir) {
  const state = loadPmState(stateDir);
  const task = state.tasks.find((entry) => entry.id === readString(args.taskId));
  if (!task) {
    return JSON.stringify({ error: `Task not found: ${readString(args.taskId)}` });
  }

  if (readString(args.status)) {
    task.status = readString(args.status);
  }
  if (args.actualHours !== undefined) {
    task.actualHours = readPositiveNumber(args.actualHours) || 0;
  }
  if (readString(args.assignee)) {
    task.assignee = readString(args.assignee);
  }
  task.updatedAt = new Date().toISOString();

  const project = state.projects.find((entry) => entry.id === task.projectId);
  if (project) {
    project.spent = state.tasks
      .filter((entry) => entry.projectId === project.id)
      .reduce((sum, entry) => sum + (entry.actualHours || 0), 0) * 3000;
    project.updatedAt = new Date().toISOString();
  }

  savePmState(stateDir, state);

  return JSON.stringify(
    {
      success: true,
      task: {
        id: task.id,
        status: task.status,
        hours: task.actualHours ?? null,
        assignee: task.assignee || null,
      },
    },
    null,
    2,
  );
}

function buildEvm(project, percentComplete) {
  const pv = project.budget;
  const ev = pv * (percentComplete / 100);
  const ac = project.spent;
  const cpiRaw = ac > 0 ? ev / ac : ev > 0 ? Infinity : 0;
  const cpi = cpiRaw === Infinity ? 999.99 : Number(cpiRaw.toFixed(2));
  const spi = pv > 0 ? Number((ev / pv).toFixed(2)) : 0;
  const eac = cpiRaw > 0 && Number.isFinite(cpiRaw) ? Number((pv / cpiRaw).toFixed(2)) : pv;
  const variance = Number((ev - ac).toFixed(2));

  let status = "on-track";
  if (cpiRaw === Infinity || cpiRaw > 1.1) {
    status = "ahead";
  } else if (cpiRaw < 0.8 || spi < 0.8) {
    status = "behind";
  } else if (cpiRaw < 0.95 || spi < 0.95) {
    status = "at-risk";
  }

  return {
    project: project.name,
    pv,
    ev,
    ac,
    cpi,
    spi,
    eac,
    variance,
    status,
  };
}

function handleEvm(args, stateDir) {
  const state = loadPmState(stateDir);
  const project = state.projects.find((entry) => entry.id === readString(args.projectId));
  if (!project) {
    return JSON.stringify({ error: `Project not found: ${readString(args.projectId)}` });
  }
  const percentComplete = Math.min(100, Math.max(0, readPositiveNumber(args.percentComplete) || 0));
  return JSON.stringify(buildEvm(project, percentComplete), null, 2);
}

function handleStatus(args, stateDir) {
  const state = loadPmState(stateDir);
  const project = state.projects.find((entry) => entry.id === readString(args.projectId));
  if (!project) {
    return JSON.stringify({ error: `Project not found: ${readString(args.projectId)}` });
  }

  const projectTasks = state.tasks.filter((task) => task.projectId === project.id);
  const doneTasks = projectTasks.filter((task) => task.status === "done").length;
  const percentComplete = projectTasks.length === 0 ? 0 : (doneTasks / projectTasks.length) * 100;
  const evm = buildEvm(project, percentComplete);

  return JSON.stringify(
    {
      project: project.name,
      context: {
        sessionKey: project.sessionKey || null,
        workdir: project.workdir || null,
      },
      tasks: {
        total: projectTasks.length,
        done: doneTasks,
        active: projectTasks.filter((task) => task.status !== "done").length,
      },
      progress: `${percentComplete.toFixed(1)}%`,
      budget: {
        planned: project.budget,
        spent: project.spent,
        remaining: Math.max(0, project.budget - project.spent),
      },
      evm,
      alerts: [
        ...(project.spent > project.budget ? ["Budget exceeded"] : []),
        ...(projectTasks.some((task) => task.priority === "critical" && task.status !== "done")
          ? ["Critical tasks still open"]
          : []),
      ],
    },
    null,
    2,
  );
}

function collectProjectContext({
  stateDir,
  sessionKey,
  workdir,
  runLimit = 5,
  memoryTodayText = "",
  memoryLongtermText = "",
}) {
  const normalized = normalizeContext({ sessionKey, workdir });
  const state = loadPmState(stateDir);
  const sessions = loadPersistedSessions(stateDir);
  const runs = loadPersistedRuns(stateDir);

  const relatedProjects = filterProjectsByContext(state.projects, normalized).map((project) =>
    enrichProject(project, state.tasks),
  );
  const relatedRuns = Array.from(runs.values())
    .filter((run) => {
      if (normalized.sessionKey && run.sessionKey === normalized.sessionKey) return true;
      if (normalized.workdir && run.workdir === normalized.workdir) return true;
      return false;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, Math.floor(runLimit)));

  const boundSession = normalized.sessionKey
    ? sessions.get(normalized.sessionKey) || null
    : null;

  return {
    sessionKey: normalized.sessionKey || null,
    workdir: normalized.workdir || null,
    boundSession,
    relatedRuns,
    relatedProjects,
    memoryTodayText: readString(memoryTodayText),
    memoryLongtermText: readString(memoryLongtermText),
  };
}

export function buildProjectContextText(options) {
  const context = collectProjectContext(options);
  const lines = ["# FreeClaude Shared Project Context", ""];

  lines.push(`Session key: ${context.sessionKey || "n/a"}`);
  lines.push(`Workdir: ${context.workdir || "n/a"}`);
  if (context.boundSession) {
    lines.push(
      `Bound FreeClaude session: ${context.boundSession.freeClaudeSessionId} (${context.boundSession.lastStatus || "unknown"})`,
    );
  }
  lines.push("");

  if (context.relatedProjects.length > 0) {
    lines.push("## PM projects");
    for (const project of context.relatedProjects) {
      lines.push(`- ${project.name} (${project.id}) — status: ${project.status}, tasks: ${project.tasks.length}`);
      for (const task of project.tasks.slice(0, 5)) {
        lines.push(`  - [${task.status}] ${task.title} (${task.id})`);
      }
    }
    lines.push("");
  }

  if (context.relatedRuns.length > 0) {
    lines.push("## Recent FreeClaude runs");
    for (const run of context.relatedRuns) {
      lines.push(`- ${run.runId} [${run.status}] ${run.mode} — ${run.summary || run.task}`);
    }
    lines.push("");
  }

  if (context.memoryTodayText) {
    lines.push("## OpenClaw memory today");
    lines.push(context.memoryTodayText.slice(0, 1200));
    lines.push("");
  }

  if (context.memoryLongtermText) {
    lines.push("## OpenClaw long-term memory");
    lines.push(context.memoryLongtermText.slice(0, 1200));
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function handlePmToolCall(name, args, options) {
  const stateDir = readString(options?.stateDir);
  const memoryTodayText = options?.memoryTodayText || "";
  const memoryLongtermText = options?.memoryLongtermText || "";

  switch (name) {
    case "pm_project_create":
      return handleProjectCreate(args, stateDir);
    case "pm_project_list":
      return handleProjectList(args, stateDir);
    case "pm_task_create":
      return handleTaskCreate(args, stateDir);
    case "pm_task_update":
      return handleTaskUpdate(args, stateDir);
    case "pm_evm":
      return handleEvm(args, stateDir);
    case "pm_status":
      return handleStatus(args, stateDir);
    case "freeclaude_project_context":
      return JSON.stringify(
        {
          success: true,
          context: collectProjectContext({
            stateDir,
            sessionKey: args?.sessionKey,
            workdir: args?.workdir,
            runLimit: args?.runLimit,
            memoryTodayText,
            memoryLongtermText,
          }),
        },
        null,
        2,
      );
    default:
      return JSON.stringify({ error: `Unknown bidirectional MCP tool: ${name}` });
  }
}
