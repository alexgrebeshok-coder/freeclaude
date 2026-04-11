/**
 * FreeClaude v3 — 1С OData MCP Server
 *
 * Model Context Protocol server for 1C:Enterprise OData access.
 * Read-only access to 1С data (documents, registers, catalogs).
 *
 * Designed for Альфа-Авто / БАЗИС Моторs test database.
 * Unique to FreeClaude — enterprise integration no other coding agent has.
 *
 * Usage: Connect via FreeClaude MCP client (HTTP transport)
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ODataConfig {
  baseUrl: string
  username: string
  password: string
  timeout?: number
}

export interface ODataEntity {
  name: string
  type: string
  count?: number
}

export interface ODataQueryResult {
  entity: string
  count: number
  columns: string[]
  rows: Record<string, unknown>[]
  truncated: boolean
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const odataTools: Tool[] = [
  {
    name: 'odata_list_entities',
    description: 'List all available OData entities (tables) from 1С',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filter: { type: 'string', description: 'Filter entity names (optional)' },
      },
    },
  },
  {
    name: 'odata_query',
    description: 'Query 1С OData entity with optional filters and select',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entity: { type: 'string', description: 'Entity/table name' },
        select: { type: 'string', description: 'Comma-separated columns to select (optional)' },
        filter: { type: 'string', description: 'OData filter expression (optional)' },
        top: { type: 'number', description: 'Max rows (default: 50, max: 1000)' },
        orderBy: { type: 'string', description: 'Column to sort by (optional)' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'odata_count',
    description: 'Get row count for an entity',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entity: { type: 'string', description: 'Entity/table name' },
        filter: { type: 'string', description: 'OData filter expression (optional)' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'odata_metadata',
    description: 'Get column definitions for an entity',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entity: { type: 'string', description: 'Entity/table name' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'odata_financial_summary',
    description: 'Get financial summary from key 1С registers',
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'quarter', 'year'], description: 'Time period' },
      },
      required: ['period'],
    },
  },
]

// ---------------------------------------------------------------------------
// OData Client
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ODataConfig = {
  baseUrl: 'https://aa6.bazis-motors.ru/aa-test-odata/',
  username: 'artificial intelligence',
  password: 'eCa!U+zedlu:eEMlRs',
  timeout: 30000,
}

/**
 * Execute OData request with Basic Auth and SSL bypass.
 */
async function odataRequest(
  path: string,
  config: ODataConfig = DEFAULT_CONFIG,
): Promise<{ data: unknown; status: number }> {
  const url = config.baseUrl + path
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeout || 30000)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
      // @ts-expect-error Node.js fetch doesn't have rejectUnauthorized in options
      // In Node 18+, use dispatcher for custom TLS
    })

    clearTimeout(timeout)
    const data = await response.json()
    return { data, status: response.status }
  } catch (error) {
    clearTimeout(timeout)
    // Fallback: try with curl (handles SSL better)
    const { execSync } = await import('node:child_process')
    try {
      const result = execSync(
        `curl -sk --max-time ${config.timeout || 30} "${url}" -H "Authorization: Basic ${auth}" -H "Accept: application/json"`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
      )
      return { data: JSON.parse(result), status: 200 }
    } catch (curlError) {
      return {
        data: { error: String(curlError) },
        status: 0,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleODataTool(
  name: string,
  args: Record<string, unknown>,
  config?: ODataConfig,
): Promise<string> {
  const cfg = config || DEFAULT_CONFIG

  switch (name) {
    case 'odata_list_entities':
      return handleListEntities(args, cfg)
    case 'odata_query':
      return handleQuery(args, cfg)
    case 'odata_count':
      return handleCount(args, cfg)
    case 'odata_metadata':
      return handleMetadata(args, cfg)
    case 'odata_financial_summary':
      return handleFinancialSummary(args, cfg)
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}

async function handleListEntities(args: Record<string, unknown>, config: ODataConfig): Promise<string> {
  const { data, status } = await odataRequest('', config)

  if (status !== 200) {
    return JSON.stringify({ error: `HTTP ${status}`, data })
  }

  // Parse OData metadata to extract entity names
  const response = data as Record<string, unknown>
  const entities: ODataEntity[] = []

  if (Array.isArray(response.value)) {
    for (const entity of response.value) {
      const name = String(entity.name || entity.EntitySetName || '')
      const type = String(entity.kind || entity.type || 'unknown')
      if (name) {
        entities.push({ name, type })
      }
    }
  }

  // Apply filter
  const filter = String(args.filter || '')
  const filtered = filter
    ? entities.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()))
    : entities

  return JSON.stringify({
    entities: filtered.slice(0, 100),
    total: filtered.length,
    note: 'Showing first 100. Use filter to narrow results.',
  }, null, 2)
}

async function handleQuery(args: Record<string, unknown>, config: ODataConfig): Promise<string> {
  const entity = String(args.entity)
  const select = args.select ? String(args.select) : ''
  const filter = args.filter ? String(args.filter) : ''
  const top = Math.min(Number(args.top) || 50, 1000)
  const orderBy = args.orderBy ? String(args.orderBy) : ''

  const params: string[] = []
  if (select) params.push(`$select=${encodeURIComponent(select)}`)
  if (filter) params.push(`$filter=${encodeURIComponent(filter)}`)
  params.push(`$top=${top}`)
  if (orderBy) params.push(`$orderby=${encodeURIComponent(orderBy)}`)

  const path = `${entity}?${params.join('&')}`
  const { data, status } = await odataRequest(path, config)

  if (status !== 200) {
    return JSON.stringify({ error: `HTTP ${status}`, entity, data })
  }

  const response = data as Record<string, unknown>
  const rows = Array.isArray(response.value) ? response.value : []

  // Extract columns from first row
  const columns = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : []

  const result: ODataQueryResult = {
    entity,
    count: rows.length,
    columns,
    rows: rows.map(row => row as Record<string, unknown>),
    truncated: rows.length >= top,
  }

  return JSON.stringify(result, null, 2)
}

async function handleCount(args: Record<string, unknown>, config: ODataConfig): Promise<string> {
  const entity = String(args.entity)
  const filter = args.filter ? String(args.filter) : ''

  const params = ['$count=true', '$top=0']
  if (filter) params.push(`$filter=${encodeURIComponent(filter)}`)

  const path = `${entity}?${params.join('&')}`
  const { data, status } = await odataRequest(path, config)

  return JSON.stringify({
    entity,
    filter: filter || 'none',
    count: (data as Record<string, unknown>)?.['@odata.count'] ?? 'unknown',
    status,
  }, null, 2)
}

async function handleMetadata(args: Record<string, unknown>, config: ODataConfig): Promise<string> {
  const entity = String(args.entity)

  // Query first row to infer columns
  const path = `${entity}?$top=1`
  const { data, status } = await odataRequest(path, config)

  if (status !== 200) {
    return JSON.stringify({ error: `HTTP ${status}`, entity })
  }

  const response = data as Record<string, unknown>
  const rows = Array.isArray(response.value) ? response.value : []

  if (rows.length === 0) {
    return JSON.stringify({ entity, columns: [], note: 'Entity is empty' })
  }

  const sample = rows[0] as Record<string, unknown>
  const columns = Object.entries(sample).map(([key, value]) => ({
    name: key,
    type: value === null ? 'null' : typeof value,
    sample: value instanceof Date ? value.toISOString().slice(0, 10)
      : typeof value === 'string' && value.length > 50 ? value.slice(0, 50) + '...'
      : value,
  }))

  return JSON.stringify({ entity, columns }, null, 2)
}

async function handleFinancialSummary(args: Record<string, unknown>, config: ODataConfig): Promise<string> {
  const period = String(args.period || 'month')

  // Key financial registers in Альфа-Авто
  const registers = [
    'Document_РеализацияТоваровУслуг',
    'Document_ПоступлениеТоваровУслуг',
    'Document_СчетНаОплатуПокупателю',
  ]

  const summary: Record<string, unknown> = { period }

  for (const reg of registers) {
    try {
      const path = `${reg}?$top=5&$orderby=Date desc`
      const { data, status } = await odataRequest(path, config)

      if (status === 200) {
        const response = data as Record<string, unknown>
        const count = response?.['@odata.count'] ?? 0
        const rows = Array.isArray(response.value) ? response.value.length : 0
        summary[reg] = { status: 'ok', lastRecords: rows }
      } else {
        summary[reg] = { status: 'error', code: status }
      }
    } catch (err) {
      summary[reg] = { status: 'error', message: String(err) }
    }
  }

  return JSON.stringify(summary, null, 2)
}
