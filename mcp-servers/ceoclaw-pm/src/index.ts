/**
 * CEOClaw PM MCP Server
 *
 * Project management tools: projects, tasks, EVM (Earned Value Management),
 * resource tracking, risk management.
 *
 * Storage: JSON files in ~/.freeclaude/pm/
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ─── Storage ───────────────────────────────────────────────────────────────

const PM_DIR = join(homedir(), '.freeclaude', 'pm')

function ensureDir(): void {
  if (!existsSync(PM_DIR)) mkdirSync(PM_DIR, { recursive: true })
}

function readJSON<T>(file: string, fallback: T): T {
  const path = join(PM_DIR, file)
  if (!existsSync(path)) return fallback
  try { return JSON.parse(readFileSync(path, 'utf-8')) as T }
  catch { return fallback }
}

function writeJSON(file: string, data: unknown): void {
  ensureDir()
  writeFileSync(join(PM_DIR, file), JSON.stringify(data, null, 2) + '\n')
}

// ─── Types ─────────────────────────────────────────────────────────────────

type Project = {
  id: string
  name: string
  description: string
  status: 'planning' | 'active' | 'on-hold' | 'completed'
  createdAt: string
  updatedAt: string
  budget: number
  currency: string
}

type Task = {
  id: string
  projectId: string
  title: string
  description: string
  status: 'todo' | 'in-progress' | 'done' | 'blocked'
  priority: 'low' | 'medium' | 'high' | 'critical'
  assignee?: string
  estimatedHours: number
  actualHours: number
  createdAt: string
  updatedAt: string
  dependencies?: string[]
}

type EVMData = {
  projectId: string
  date: string
  pv: number    // Planned Value (BCWS)
  ev: number    // Earned Value (BCWP)
  ac: number    // Actual Cost (ACWP)
  bac: number   // Budget at Completion
}

// ─── Helper Functions ─────────────────────────────────────────────────────

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function getProjects(): Project[] {
  return readJSON<Project[]>('projects.json', [])
}

function getTasks(): Task[] {
  return readJSON<Task[]>('tasks.json', [])
}

function getEVMData(): EVMData[] {
  return readJSON<EVMData[]>('evm.json', [])
}

// ─── EVM Calculations ─────────────────────────────────────────────────────

function calculateEVM(bac: number, pv: number, ev: number, ac: number) {
  const cv = ev - ac                                     // Cost Variance
  const sv = ev - pv                                     // Schedule Variance
  const cpi = ac > 0 ? ev / ac : 0                      // Cost Performance Index
  const spi = pv > 0 ? ev / pv : 0                      // Schedule Performance Index
  const eac = cpi > 0 ? bac / cpi : bac * 2             // Estimate at Completion
  const etc = eac - ac                                   // Estimate to Complete
  const tcpi = (bac - ev) / (bac - ac)                   // To-Complete Performance Index
  const vac = bac - eac                                  // Variance at Completion
  const completePct = bac > 0 ? (ev / bac) * 100 : 0    // % Complete

  return {
    cv, sv, cpi, spi, eac, etc, tcpi, vac, completePct,
    health: cpi >= 0.9 && spi >= 0.9 ? '🟢 Healthy' :
           cpi >= 0.8 && spi >= 0.8 ? '🟡 Warning' : '🔴 Critical',
  }
}

// ─── Tool Handlers ─────────────────────────────────────────────────────────

function handleProjectCreate(args: Record<string, unknown>): string {
  const projects = getProjects()
  const project: Project = {
    id: genId(),
    name: String(args.name ?? 'Unnamed Project'),
    description: String(args.description ?? ''),
    status: String(args.status ?? 'planning') as Project['status'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    budget: Number(args.budget ?? 0),
    currency: String(args.currency ?? 'RUB'),
  }
  projects.push(project)
  writeJSON('projects.json', projects)
  return JSON.stringify({ ok: true, project }, null, 2)
}

function handleProjectList(_args: Record<string, unknown>): string {
  const projects = getProjects()
  const tasks = getTasks()
  const enriched = projects.map(p => {
    const pTasks = tasks.filter(t => t.projectId === p.id)
    return {
      ...p,
      taskCount: pTasks.length,
      doneTasks: pTasks.filter(t => t.status === 'done').length,
      totalHours: pTasks.reduce((s, t) => s + t.estimatedHours, 0),
    }
  })
  return JSON.stringify(enriched, null, 2)
}

function handleTaskCreate(args: Record<string, unknown>): string {
  const tasks = getTasks()
  const task: Task = {
    id: genId(),
    projectId: String(args.projectId ?? ''),
    title: String(args.title ?? 'Untitled Task'),
    description: String(args.description ?? ''),
    status: String(args.status ?? 'todo') as Task['status'],
    priority: String(args.priority ?? 'medium') as Task['priority'],
    assignee: args.assignee ? String(args.assignee) : undefined,
    estimatedHours: Number(args.estimatedHours ?? 0),
    actualHours: Number(args.actualHours ?? 0),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dependencies: args.dependencies ? String(args.dependencies).split(',').map(s => s.trim()) : undefined,
  }
  tasks.push(task)
  writeJSON('tasks.json', tasks)
  return JSON.stringify({ ok: true, task }, null, 2)
}

function handleTaskUpdate(args: Record<string, unknown>): string {
  const tasks = getTasks()
  const idx = tasks.findIndex(t => t.id === args.id)
  if (idx === -1) return JSON.stringify({ ok: false, error: 'Task not found' })

  const task = tasks[idx]!
  if (args.title !== undefined) task.title = String(args.title)
  if (args.description !== undefined) task.description = String(args.description)
  if (args.status !== undefined) task.status = String(args.status) as Task['status']
  if (args.priority !== undefined) task.priority = String(args.priority) as Task['priority']
  if (args.assignee !== undefined) task.assignee = String(args.assignee)
  if (args.actualHours !== undefined) task.actualHours = Number(args.actualHours)
  if (args.estimatedHours !== undefined) task.estimatedHours = Number(args.estimatedHours)
  task.updatedAt = new Date().toISOString()

  tasks[idx] = task
  writeJSON('tasks.json', tasks)
  return JSON.stringify({ ok: true, task }, null, 2)
}

function handleEVM(args: Record<string, unknown>): string {
  const projectId = String(args.projectId ?? '')
  const projects = getProjects()
  const project = projects.find(p => p.id === projectId)
  if (!project) return JSON.stringify({ ok: false, error: 'Project not found' })

  const evmData = getEVMData()
  const latest = evmData.filter(e => e.projectId === projectId).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )[0]

  if (!latest) {
    return JSON.stringify({
      project,
      evm: { message: 'No EVM data yet. Record PV/EV/AC to start tracking.' },
    }, null, 2)
  }

  const metrics = calculateEVM(project.budget, latest.pv, latest.ev, latest.ac)

  return JSON.stringify({
    project: project.name,
    date: latest.date,
    budget: { bac: project.budget, currency: project.currency },
    evm: {
      pv: latest.pv,
      ev: latest.ev,
      ac: latest.ac,
      ...metrics,
    },
    interpretation: [
      metrics.cpi >= 1 ? 'Under budget (CPI ≥ 1.0)' : `Over budget (CPI ${metrics.cpi.toFixed(2)} < 1.0)`,
      metrics.spi >= 1 ? 'Ahead of schedule (SPI ≥ 1.0)' : `Behind schedule (SPI ${metrics.spi.toFixed(2)} < 1.0)`,
      `EAC: ${metrics.eac.toFixed(0)} ${project.currency} (${metrics.cpi >= 1 ? 'under' : 'over'} budget by ${Math.abs(metrics.vac).toFixed(0)})`,
    ],
  }, null, 2)
}

function handleEVMRecord(args: Record<string, unknown>): string {
  const data: EVMData = {
    projectId: String(args.projectId ?? ''),
    date: String(args.date ?? new Date().toISOString().split('T')[0]),
    pv: Number(args.pv ?? 0),
    ev: Number(args.ev ?? 0),
    ac: Number(args.ac ?? 0),
    bac: Number(args.bac ?? 0),
  }
  const evmData = getEVMData()
  evmData.push(data)
  writeJSON('evm.json', evmData)

  const project = getProjects().find(p => p.id === data.projectId)
  const bac = data.bac || project?.budget || 0
  const metrics = calculateEVM(bac, data.pv, data.ev, data.ac)

  return JSON.stringify({ ok: true, ...metrics }, null, 2)
}

function handleStatus(_args: Record<string, unknown>): string {
  const projects = getProjects()
  const tasks = getTasks()
  const evmData = getEVMData()

  return JSON.stringify({
    projects: projects.length,
    tasks: tasks.length,
    tasksByStatus: {
      todo: tasks.filter(t => t.status === 'todo').length,
      'in-progress': tasks.filter(t => t.status === 'in-progress').length,
      done: tasks.filter(t => t.status === 'done').length,
      blocked: tasks.filter(t => t.status === 'blocked').length,
    },
    evmRecords: evmData.length,
    totalBudget: projects.reduce((s, p) => s + p.budget, 0),
  }, null, 2)
}

// ─── MCP Server ───────────────────────────────────────────────────────────

const server = new Server(
  { name: 'ceoclaw-pm', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'pm_project_create',
      description: 'Create a new project. Fields: name, description, budget, currency (RUB/USD), status (planning/active/on-hold/completed)',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project name' },
          description: { type: 'string', description: 'Project description' },
          budget: { type: 'number', description: 'Total budget' },
          currency: { type: 'string', enum: ['RUB', 'USD', 'EUR'], default: 'RUB' },
          status: { type: 'string', enum: ['planning', 'active', 'on-hold', 'completed'], default: 'planning' },
        },
        required: ['name'],
      },
    },
    {
      name: 'pm_project_list',
      description: 'List all projects with task counts and progress',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'pm_task_create',
      description: 'Create a task in a project. Fields: projectId, title, description, priority, estimatedHours, assignee',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID' },
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'Task description' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
          estimatedHours: { type: 'number', description: 'Estimated hours' },
          assignee: { type: 'string', description: 'Assignee name' },
          status: { type: 'string', enum: ['todo', 'in-progress', 'done', 'blocked'], default: 'todo' },
        },
        required: ['projectId', 'title'],
      },
    },
    {
      name: 'pm_task_update',
      description: 'Update a task: status, actualHours, priority, assignee, title, description',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID' },
          status: { type: 'string' },
          actualHours: { type: 'number' },
          priority: { type: 'string' },
          assignee: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          estimatedHours: { type: 'number' },
        },
        required: ['id'],
      },
    },
    {
      name: 'pm_evm',
      description: 'Get EVM metrics for a project: CPI, SPI, EAC, ETC, cost/schedule variance, health status',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID' },
        },
        required: ['projectId'],
      },
    },
    {
      name: 'pm_evm_record',
      description: 'Record EVM data point: PV (planned value), EV (earned value), AC (actual cost)',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID' },
          date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
          pv: { type: 'number', description: 'Planned Value (BCWS)' },
          ev: { type: 'number', description: 'Earned Value (BCWP)' },
          ac: { type: 'number', description: 'Actual Cost (ACWP)' },
          bac: { type: 'number', description: 'Budget at Completion' },
        },
        required: ['projectId', 'pv', 'ev', 'ac'],
      },
    },
    {
      name: 'pm_status',
      description: 'Overall PM status: project count, task breakdown, budget totals',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  const handlers: Record<string, (args: Record<string, unknown>) => string> = {
    pm_project_create: handleProjectCreate,
    pm_project_list: handleProjectList,
    pm_task_create: handleTaskCreate,
    pm_task_update: handleTaskUpdate,
    pm_evm: handleEVM,
    pm_evm_record: handleEVMRecord,
    pm_status: handleStatus,
  }

  const handler = handlers[name]
  if (!handler) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }

  try {
    const result = handler(args ?? {})
    return { content: [{ type: 'text', text: result }] }
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
  }
})

// ─── Start ────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('CEOClaw PM MCP Server running on stdio')
}

main().catch(console.error)
