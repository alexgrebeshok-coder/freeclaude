import type { Command } from '../../commands.js'
import type { Tool } from '../../Tool.js'
import { ListMcpResourcesTool } from '../../tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import { ReadMcpResourceTool } from '../../tools/ReadMcpResourceTool/ReadMcpResourceTool.js'
import { toolMatchesName } from '../../Tool.js'
import type { MCPServerConnection, ServerResource } from './types.js'

export type McpConnectionCatalog = {
  tools: Tool[]
  commands: Command[]
  resources?: ServerResource[]
  addedSharedResourceTools: boolean
}

export async function loadMcpConnectionCatalog({
  client,
  fetchTools,
  fetchCommands,
  fetchResources,
  fetchSkills,
  includeSharedResourceTools,
}: {
  client: MCPServerConnection
  fetchTools: (client: MCPServerConnection) => Promise<Tool[]>
  fetchCommands: (client: MCPServerConnection) => Promise<Command[]>
  fetchResources: (client: MCPServerConnection) => Promise<ServerResource[]>
  fetchSkills?: (client: MCPServerConnection) => Promise<Command[]>
  includeSharedResourceTools: boolean
}): Promise<McpConnectionCatalog> {
  const supportsResources = !!client.capabilities?.resources

  const [tools, mcpCommands, mcpSkills, resources] = await Promise.all([
    fetchTools(client),
    fetchCommands(client),
    fetchSkills && supportsResources ? fetchSkills(client) : Promise.resolve([]),
    supportsResources ? fetchResources(client) : Promise.resolve([]),
  ])

  let addedSharedResourceTools = false
  const resourceTools: Tool[] = []
  if (supportsResources && includeSharedResourceTools) {
    const hasResourceTools = [ListMcpResourcesTool, ReadMcpResourceTool].some(
      tool => tools.some(t => toolMatchesName(t, tool.name)),
    )
    if (!hasResourceTools) {
      resourceTools.push(ListMcpResourcesTool, ReadMcpResourceTool)
      addedSharedResourceTools = true
    }
  }

  return {
    tools: [...tools, ...resourceTools],
    commands: [...mcpCommands, ...mcpSkills],
    resources: resources.length > 0 ? resources : undefined,
    addedSharedResourceTools,
  }
}
