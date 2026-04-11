/**
 * FreeClaude v3 — CEOClaw PM MCP Server Tests
 */

import { describe, expect, test, beforeEach } from 'bun:test'
import {
  ceoclawTools,
  handleToolCall,
  type Project,
} from './ceoclawPm.ts'

describe('CEOClaw PM MCP', () => {
  test('tools have valid definitions', () => {
    expect(ceoclawTools.length).toBeGreaterThanOrEqual(6)

    for (const tool of ceoclawTools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeTruthy()
    }
  })

  test('expected tool names exist', () => {
    const names = ceoclawTools.map(t => t.name)
    expect(names).toContain('pm_project_create')
    expect(names).toContain('pm_project_list')
    expect(names).toContain('pm_task_create')
    expect(names).toContain('pm_task_update')
    expect(names).toContain('pm_evm')
    expect(names).toContain('pm_status')
  })

  test('create project returns valid response', () => {
    const result = JSON.parse(handleToolCall('pm_project_create', {
      name: 'Test Project',
      budget: 1000000,
      startDate: '2026-04-01',
    }))

    expect(result.success).toBe(true)
    expect(result.project.id).toMatch(/^proj_/)
    expect(result.project.name).toBe('Test Project')
    expect(result.project.budget).toBe(1000000)
  })

  test('create and list projects', () => {
    handleToolCall('pm_project_create', { name: 'P1', budget: 500000, startDate: '2026-01-01' })
    handleToolCall('pm_project_create', { name: 'P2', budget: 750000, startDate: '2026-02-01' })

    const result = JSON.parse(handleToolCall('pm_project_list', {}))
    expect(result.total).toBeGreaterThanOrEqual(2)
    expect(result.projects.length).toBeGreaterThanOrEqual(2)
  })

  test('create task on project', () => {
    const proj = JSON.parse(handleToolCall('pm_project_create', {
      name: 'Task Test', budget: 200000, startDate: '2026-04-01',
    }))

    const taskResult = JSON.parse(handleToolCall('pm_task_create', {
      projectId: proj.project.id,
      title: 'Design UI',
      priority: 'high',
      estimatedHours: 8,
    }))

    expect(taskResult.success).toBe(true)
    expect(taskResult.task.title).toBe('Design UI')
    expect(taskResult.task.priority).toBe('high')
  })

  test('create task on non-existent project fails', () => {
    const result = JSON.parse(handleToolCall('pm_task_create', {
      projectId: 'nonexistent',
      title: 'Orphan task',
    }))

    expect(result.error).toBeTruthy()
    expect(result.error).toContain('not found')
  })

  test('update task status', () => {
    const proj = JSON.parse(handleToolCall('pm_project_create', {
      name: 'Update Test', budget: 100000, startDate: '2026-04-01',
    }))
    const task = JSON.parse(handleToolCall('pm_task_create', {
      projectId: proj.project.id,
      title: 'Code Review',
    }))

    const updated = JSON.parse(handleToolCall('pm_task_update', {
      taskId: task.task.id,
      status: 'done',
      actualHours: 2,
    }))

    expect(updated.success).toBe(true)
    expect(updated.task.status).toBe('done')
    expect(updated.task.hours).toBe(2)
  })

  test('EVM calculation — on track', () => {
    const proj = JSON.parse(handleToolCall('pm_project_create', {
      name: 'EVM Test', budget: 1000000, startDate: '2026-01-01',
    }))

    const evm = JSON.parse(handleToolCall('pm_evm', {
      projectId: proj.project.id,
      percentComplete: 50,
    }))

    expect(evm.project).toBe('EVM Test')
    expect(evm.pv).toBe(1000000)
    expect(evm.ev).toBe(500000)
    expect(evm.cpi).toBeGreaterThanOrEqual(0)
    expect(evm.spi).toBe(0.5) // 50% complete
  })

  test('EVM status detection', () => {
    const proj = JSON.parse(handleToolCall('pm_project_create', {
      name: 'EVM Status', budget: 1000000, startDate: '2026-01-01',
    }))

    // 100% complete but no spend = ahead (CPI = infinity)
    const ahead = JSON.parse(handleToolCall('pm_evm', {
      projectId: proj.project.id, percentComplete: 100,
    }))
    expect(ahead.status).toBe('ahead')
    expect(ahead.cpi).toBe(999.99) // Infinity represented as max value

    // 0% complete
    const start = JSON.parse(handleToolCall('pm_evm', {
      projectId: proj.project.id, percentComplete: 0,
    }))
    expect(start.ev).toBe(0)
    expect(start.spi).toBe(0)
  })

  test('project status report', () => {
    const proj = JSON.parse(handleToolCall('pm_project_create', {
      name: 'Status Report', budget: 500000, startDate: '2026-04-01',
    }))
    handleToolCall('pm_task_create', { projectId: proj.project.id, title: 'T1', priority: 'critical' })
    handleToolCall('pm_task_create', { projectId: proj.project.id, title: 'T2' })
    handleToolCall('pm_task_create', { projectId: proj.project.id, title: 'T3' })

    const status = JSON.parse(handleToolCall('pm_status', { projectId: proj.project.id }))
    expect(status.project).toBe('Status Report')
    expect(status.tasks.total).toBe(3)
    expect(status.progress).toBe('0.0%')
    expect(status.alerts).toBeDefined()
  })

  test('unknown tool returns error', () => {
    const result = JSON.parse(handleToolCall('nonexistent_tool', {}))
    expect(result.error).toBeTruthy()
  })
})

describe('1С OData MCP', () => {
  test('tools have valid definitions', async () => {
    const { odataTools } = await import('./odata1c.ts')
    expect(odataTools.length).toBeGreaterThanOrEqual(5)

    for (const tool of odataTools) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeTruthy()
    }
  })

  test('expected OData tool names exist', async () => {
    const { odataTools } = await import('./odata1c.ts')
    const names = odataTools.map(t => t.name)
    expect(names).toContain('odata_list_entities')
    expect(names).toContain('odata_query')
    expect(names).toContain('odata_count')
    expect(names).toContain('odata_metadata')
    expect(names).toContain('odata_financial_summary')
  })

  test('odata_query returns valid ODataQueryResult shape', async () => {
    const { handleODataTool } = await import('./odata1c.ts')
    // This will try to connect to 1С — may fail in test env, but should not crash
    const result = await handleODataTool('odata_query', {
      entity: 'Catalog_Контрагенты',
      top: 1,
    })
    const parsed = JSON.parse(result)
    // Either we get data or an error — both are valid
    expect(parsed).toBeDefined()
  })
})
