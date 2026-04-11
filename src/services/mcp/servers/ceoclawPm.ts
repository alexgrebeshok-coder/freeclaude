/**
 * FreeClaude v3 — CEOClaw PM MCP Server
 *
 * Model Context Protocol server for project management.
 * Provides tools for EVM metrics, task management, and project status.
 *
 * Unique to FreeClaude — no other coding agent has PM tools.
 *
 * Usage: Connect via FreeClaude MCP client (stdio transport)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Project {
  id: string
  name: string
  status: 'planning' | 'active' | 'on-hold' | 'completed'
  budget: number
  spent: number
  startDate: string
  endDate?: string
  tasks: Task[]
}

export interface Task {
  id: string
  projectId: string
  title: string
  status: 'todo' | 'in-progress' | 'review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'critical'
  assignee?: string
  estimatedHours?: number
  actualHours?: number
  dueDate?: string
}

export interface EVMData {
  project: string
  pv: number   // Planned Value
  ev: number   // Earned Value
  ac: number   // Actual Cost
  cpi: number  // Cost Performance Index
  spi: number  // Schedule Performance Index
  eac: number  // Estimate at Completion
  variance: number
  status: 'ahead' | 'on-track' | 'at-risk' | 'behind'
}

// ---------------------------------------------------------------------------
// In-memory store (persisted to file in production)
// ---------------------------------------------------------------------------

const projects = new Map<string, Project>()
const tasks = new Map<string, Task>()

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const ceoclawTools: Tool[] = [
  {
    name: 'pm_project_create',
    description: 'Create a new project with name, budget, and dates',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Project name' },
        budget: { type: 'number', description: 'Budget in rubles' },
        startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        endDate: { type: 'string', description: 'End date (YYYY-MM-DD, optional)' },
      },
      required: ['name', 'budget', 'startDate'],
    },
  },
  {
    name: 'pm_project_list',
    description: 'List all projects with status and budget summary',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'pm_task_create',
    description: 'Add a task to a project',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        title: { type: 'string', description: 'Task title' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        assignee: { type: 'string', description: 'Assignee name (optional)' },
        estimatedHours: { type: 'number', description: 'Estimated hours (optional)' },
        dueDate: { type: 'string', description: 'Due date YYYY-MM-DD (optional)' },
      },
      required: ['projectId', 'title'],
    },
  },
  {
    name: 'pm_task_update',
    description: 'Update task status, hours, or assignee',
    inputSchema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        status: { type: 'string', enum: ['todo', 'in-progress', 'review', 'done'] },
        actualHours: { type: 'number', description: 'Actual hours spent' },
        assignee: { type: 'string', description: 'New assignee' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'pm_evm',
    description: 'Calculate EVM metrics (CPI, SPI, EAC) for a project',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        percentComplete: { type: 'number', description: 'Current % complete (0-100)' },
      },
      required: ['projectId', 'percentComplete'],
    },
  },
  {
    name: 'pm_status',
    description: 'Get full project status report (tasks, budget, EVM)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
      },
      required: ['projectId'],
    },
  },
]

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export function handleToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'pm_project_create':
      return handleProjectCreate(args)
    case 'pm_project_list':
      return handleProjectList()
    case 'pm_task_create':
      return handleTaskCreate(args)
    case 'pm_task_update':
      return handleTaskUpdate(args)
    case 'pm_evm':
      return handleEVM(args)
    case 'pm_status':
      return handleStatus(args)
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

// --- Handlers ---

let projectCounter = 0
let taskCounter = 0

function handleProjectCreate(args: Record<string, unknown>): string {
  const id = `proj_${(++projectCounter).toString(36)}`
  const project: Project = {
    id,
    name: String(args.name || 'Untitled'),
    status: 'planning',
    budget: Number(args.budget) || 0,
    spent: 0,
    startDate: String(args.startDate || new Date().toISOString().slice(0, 10)),
    endDate: args.endDate ? String(args.endDate) : undefined,
    tasks: [],
  }
  projects.set(id, project)
  return JSON.stringify({ success: true, project: { id: project.id, name: project.name, budget: project.budget } }, null, 2)
}

function handleProjectList(): string {
  const list = Array.from(projects.values()).map(p => ({
    id: p.id,
    name: p.name,
    status: p.status,
    budget: p.budget,
    spent: p.spent,
    tasks: p.tasks.length,
    done: p.tasks.filter(t => t.status === 'done').length,
  }))
  return JSON.stringify({ projects: list, total: list.length }, null, 2)
}

function handleTaskCreate(args: Record<string, unknown>): string {
  const projectId = String(args.projectId)
  const project = projects.get(projectId)
  if (!project) return JSON.stringify({ error: `Project not found: ${projectId}` })

  const id = `task_${(++taskCounter).toString(36)}`
  const task: Task = {
    id,
    projectId,
    title: String(args.title || 'Untitled'),
    status: 'todo',
    priority: (['low', 'medium', 'high', 'critical'].includes(String(args.priority))
      ? String(args.priority) : 'medium') as Task['priority'],
    assignee: args.assignee ? String(args.assignee) : undefined,
    estimatedHours: args.estimatedHours ? Number(args.estimatedHours) : undefined,
    dueDate: args.dueDate ? String(args.dueDate) : undefined,
  }

  tasks.set(id, task)
  project.tasks.push(task)
  return JSON.stringify({ success: true, task: { id, title: task.title, priority: task.priority } }, null, 2)
}

function handleTaskUpdate(args: Record<string, unknown>): string {
  const taskId = String(args.taskId)
  const task = tasks.get(taskId)
  if (!task) return JSON.stringify({ error: `Task not found: ${taskId}` })

  if (args.status) task.status = String(args.status) as Task['status']
  if (args.actualHours !== undefined) task.actualHours = Number(args.actualHours)
  if (args.assignee) task.assignee = String(args.assignee)

  // Update project spent
  const project = projects.get(task.projectId)
  if (project) {
    project.spent = project.tasks.reduce((sum, t) => sum + (t.actualHours || 0), 0) * 3000 // ~3000₽/hr
  }

  return JSON.stringify({ success: true, task: { id: task.id, status: task.status, hours: task.actualHours } }, null, 2)
}

function handleEVM(args: Record<string, unknown>): string {
  const projectId = String(args.projectId)
  const project = projects.get(projectId)
  if (!project) return JSON.stringify({ error: `Project not found: ${projectId}` })

  const percentComplete = Number(args.percentComplete) || 0
  const pv = project.budget // BAC = total budget
  const ev = pv * (percentComplete / 100)
  const ac = project.spent

  const cpi = ac > 0 ? ev / ac : (ev > 0 ? Infinity : 0)
  const spi = pv > 0 ? ev / pv : 0
  const eac = cpi > 0 && isFinite(cpi) ? pv / cpi : pv
  const variance = ev - ac

  let status: EVMData['status'] = 'on-track'
  if (isNaN(cpi) || isNaN(spi)) {
    status = percentComplete === 0 ? 'on-track' : 'at-risk'
  } else if (cpi === Infinity || cpi > 1.1) {
    status = 'ahead'
  } else if (cpi < 0.8 || spi < 0.8) {
    status = 'behind'
  } else if (cpi < 0.95 || spi < 0.95) {
    status = 'at-risk'
  }

  const data: EVMData = {
    project: project.name,
    pv: Math.round(pv),
    ev: Math.round(ev),
    ac: Math.round(ac),
    cpi: isFinite(cpi) ? Math.round(cpi * 100) / 100 : 999.99,
    spi: Math.round(spi * 100) / 100,
    eac: Math.round(eac),
    variance: Math.round(variance),
    status,
  }

  return JSON.stringify(data, null, 2)
}

function handleStatus(args: Record<string, unknown>): string {
  const projectId = String(args.projectId)
  const project = projects.get(projectId)
  if (!project) return JSON.stringify({ error: `Project not found: ${projectId}` })

  const totalTasks = project.tasks.length
  const doneTasks = project.tasks.filter(t => t.status === 'done').length
  const percentComplete = totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0

  // Calculate EVM
  const pv = project.budget
  const ev = pv * (percentComplete / 100)
  const ac = project.spent
  const cpi = ac > 0 ? ev / ac : 0
  const spi = pv > 0 ? ev / pv : 0

  const criticalTasks = project.tasks.filter(t => t.priority === 'critical' && t.status !== 'done')
  const overdueTasks = project.tasks.filter(t =>
    t.dueDate && t.status !== 'done' && new Date(t.dueDate) < new Date()
  )

  return JSON.stringify({
    project: project.name,
    status: project.status,
    budget: { total: project.budget, spent: project.spent, remaining: project.budget - project.spent },
    tasks: { total: totalTasks, done: doneTasks, inProgress: project.tasks.filter(t => t.status === 'in-progress').length },
    progress: `${percentComplete.toFixed(1)}%`,
    evm: { cpi: Math.round(cpi * 100) / 100, spi: Math.round(spi * 100) / 100 },
    alerts: {
      critical: criticalTasks.map(t => t.title),
      overdue: overdueTasks.map(t => `${t.title} (due: ${t.dueDate})`),
    },
  }, null, 2)
}
