/**
 * 1С OData MCP Server
 *
 * Provides read-only access to 1С:Enterprise via OData protocol.
 * Works with any 1С configuration that has OData endpoint enabled:
 * - Альфа-Авто (автодилеры)
 * - БАЗИС (строительство)
 * - ERP / Accounting / any custom config
 *
 * Auth: Basic (username:password in config)
 * Storage: ~/.freeclaude/onec-config.json
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// ─── Config ───────────────────────────────────────────────────────────────

type OneCConfig = {
  baseUrl: string        // e.g. https://1c.company.ru/odata/standard.odata
  username: string
  password: string
  database?: string
}

const CONFIG_PATH = join(homedir(), '.freeclaude', 'onec-config.json')

function getConfig(): OneCConfig | null {
  if (!existsSync(CONFIG_PATH)) return null
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as OneCConfig }
  catch { return null }
}

// ─── OData Client ─────────────────────────────────────────────────────────

async function odataRequest(
  path: string,
  config: OneCConfig,
  options?: { filter?: string; select?: string; top?: number; orderBy?: string; expand?: string }
): Promise<string> {
  const url = new URL(path, config.baseUrl)

  if (options?.filter) url.searchParams.set('$filter', options.filter)
  if (options?.select) url.searchParams.set('$select', options.select)
  if (options?.top) url.searchParams.set('$top', String(options.top))
  if (options?.orderBy) url.searchParams.set('$orderby', options.orderBy)
  if (options?.expand) url.searchParams.set('$expand', options.expand)

  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      const text = await res.text()
      return JSON.stringify({ error: `HTTP ${res.status}`, detail: text.slice(0, 500) })
    }

    const data = await res.json()
    return JSON.stringify(data, null, 2)
  } catch (err: any) {
    return JSON.stringify({ error: err.message, url: url.toString() })
  }
}

// ─── Tool Handlers ─────────────────────────────────────────────────────────

async function handleListEntities(_args: Record<string, unknown>): Promise<string> {
  const config = getConfig()
  if (!config) return JSON.stringify({
    error: '1С not configured',
    fix: 'Create ~/.freeclaude/onec-config.json with { baseUrl, username, password }',
    example: {
      baseUrl: 'https://1c.company.ru/your_db/odata/standard.odata',
      username: 'user',
      password: 'pass',
    },
  })

  return await odataRequest('', config)
}

async function handleQuery(args: Record<string, unknown>): Promise<string> {
  const config = getConfig()
  if (!config) return JSON.stringify({ error: '1С not configured. See odata_list_entities for setup.' })

  const entity = String(args.entity ?? '')
  if (!entity) return JSON.stringify({ error: 'Missing required field: entity' })

  const path = `/${entity}`
  return await odataRequest(path, config, {
    filter: args.filter ? String(args.filter) : undefined,
    select: args.select ? String(args.select) : undefined,
    top: args.top ? Number(args.top) : undefined,
    orderBy: args.orderBy ? String(args.orderBy) : undefined,
    expand: args.expand ? String(args.expand) : undefined,
  })
}

async function handleCount(args: Record<string, unknown>): Promise<string> {
  const config = getConfig()
  if (!config) return JSON.stringify({ error: '1С not configured.' })

  const entity = String(args.entity ?? '')
  if (!entity) return JSON.stringify({ error: 'Missing required field: entity' })

  const url = new URL(`/${entity}/$count`, config.baseUrl)
  if (args.filter) url.searchParams.set('$filter', String(args.filter))

  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'text/plain',
      },
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      return JSON.stringify({ error: `HTTP ${res.status}` })
    }

    const count = await res.text()
    return JSON.stringify({ entity, count: Number(count) })
  } catch (err: any) {
    return JSON.stringify({ error: err.message })
  }
}

async function handleMetadata(_args: Record<string, unknown>): Promise<string> {
  const config = getConfig()
  if (!config) return JSON.stringify({ error: '1С not configured.' })

  try {
    const url = new URL('$metadata', config.baseUrl)
    const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/xml' },
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) return JSON.stringify({ error: `HTTP ${res.status}` })

    const xml = await res.text()

    // Parse entity names from XML
    const entityNames = [...xml.matchAll(/EntityType Name="([^"]+)"/g)]
      .map(m => m[1])
      .filter(Boolean)

    const entitySets = [...xml.matchAll(/EntitySet Name="([^"]+)" EntityType="([^"]+)"/g)]
      .map(m => ({ name: m[1], type: m[2] }))

    return JSON.stringify({
      entitySets,
      totalEntityTypes: entityNames.length,
      totalEntitySets: entitySets.length,
      rawXmlLength: xml.length,
      note: 'Full XML metadata available in rawXmlLength chars. Use entity names with odata_query.',
    }, null, 2)
  } catch (err: any) {
    return JSON.stringify({ error: err.message })
  }
}

async function handleFinancialSummary(_args: Record<string, unknown>): Promise<string> {
  const config = getConfig()
  if (!config) return JSON.stringify({ error: '1С not configured.' })

  // Common 1С financial entities (varies by config)
  const commonEntities = [
    'Document_СчетНаОплатуПокупателю',  // Счет на оплату покупателю
    'Document_РеализацияТоваровУслуг',   // Реализация товаров и услуг
    'Document_ПоступлениеТоваровУслуг',   // Поступление товаров и услуг
    'Document_СчетФактура',              // Счет-фактура
    'Catalog_Контрагенты',               // Контрагенты
    'Catalog_Номенклатура',              // Номенклатура
    'Catalog_ДоговорыКонтрагентов',      // Договоры
    'AccumulationRegister_Взаиморасчеты', // Взаиморасчеты
  ]

  const results: Record<string, { status: string; count?: number }> = {}

  for (const entity of commonEntities) {
    try {
      const url = new URL(`/${entity}/$count`, config.baseUrl)
      const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64')

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Basic ${auth}`, Accept: 'text/plain' },
        signal: AbortSignal.timeout(10000),
      })

      if (res.ok) {
        const count = await res.text()
        results[entity] = { status: 'available', count: Number(count) }
      } else {
        results[entity] = { status: `not found (${res.status})` }
      }
    } catch (err: any) {
      results[entity] = { status: `error: ${err.message}` }
    }
  }

  const available = Object.entries(results).filter(([, v]) => v.status === 'available')

  return JSON.stringify({
    config: config.baseUrl,
    available: available.length,
    entities: results,
    recommendation: available.length > 0
      ? `Found ${available.length} financial entities. Use odata_query with these entity names.`
      : 'No standard financial entities found. Run odata_metadata to see available entities for your 1С config.',
  }, null, 2)
}

async function handleConfig(_args: Record<string, unknown>): Promise<string> {
  const config = getConfig()
  if (!config) {
    return JSON.stringify({
      configured: false,
      configPath: CONFIG_PATH,
      setup: {
        baseUrl: 'https://your-1c-server.ru/your_db/odata/standard.odata',
        username: 'odata_user',
        password: 'odata_password',
      },
      note: '1С OData must be enabled in 1С configuration (Publish to web / OData standard)',
    }, null, 2)
  }

  return JSON.stringify({
    configured: true,
    baseUrl: config.baseUrl.replace(/\/$/, ''),
    database: config.database ?? 'default',
    note: 'Connection is configured. Try odata_list_entities to test.',
  }, null, 2)
}

// ─── MCP Server ───────────────────────────────────────────────────────────

const server = new Server(
  { name: 'onec-odata', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'odata_config',
      description: 'Check 1С OData configuration status and setup instructions',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'odata_list_entities',
      description: 'List all available OData entities from 1С',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'odata_metadata',
      description: 'Get entity types and their properties from 1С metadata',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'odata_query',
      description: 'Query 1С OData entity with filter, select, top, orderBy, expand. Example: entity="Catalog_Контрагенты" filter="IsActive eq true"',
      inputSchema: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: 'Entity name (e.g. Catalog_Контрагенты)' },
          filter: { type: 'string', description: 'OData $filter expression' },
          select: { type: 'string', description: 'Comma-separated fields ($select)' },
          top: { type: 'number', description: 'Max records ($top)' },
          orderBy: { type: 'string', description: 'Sort field ($orderby)' },
          expand: { type: 'string', description: 'Navigation properties ($expand)' },
        },
        required: ['entity'],
      },
    },
    {
      name: 'odata_count',
      description: 'Count records in an OData entity, optionally with filter',
      inputSchema: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: 'Entity name' },
          filter: { type: 'string', description: 'OData $filter expression' },
        },
        required: ['entity'],
      },
    },
    {
      name: 'odata_financial_summary',
      description: 'Auto-detect common 1С financial entities (счета, реализации, контрагенты) and show counts',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<string> | string> = {
    odata_config: handleConfig,
    odata_list_entities: handleListEntities,
    odata_metadata: handleMetadata,
    odata_query: handleQuery,
    odata_count: handleCount,
    odata_financial_summary: handleFinancialSummary,
  }

  const handler = handlers[name]
  if (!handler) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }

  try {
    const result = await handler(args ?? {})
    return { content: [{ type: 'text', text: result }] }
  } catch (err: any) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
  }
})

// ─── Start ────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('1С OData MCP Server running on stdio')
}

main().catch(console.error)
