import type { LocalJSXCommandContext, LocalCommandResult } from '../../types/command.js'
import { buildChildMessage } from '../../tools/AgentTool/forkSubagent.js'
import {
  extractResultText,
  getLastCacheSafeParams,
  runForkedAgent,
  type CacheSafeParams,
  type ForkedAgentResult,
} from '../../utils/forkedAgent.js'
import { createUserMessage } from '../../utils/messages.js'
import { hasPermissionsToUseTool } from '../../utils/permissions/permissions.js'
import { buildSideQuestionFallbackParams } from '../../utils/queryContext.js'

type ForkCommandDeps = {
  getSavedCacheSafeParams?: () => CacheSafeParams | null
  buildFallbackCacheSafeParams?: (
    context: LocalJSXCommandContext,
  ) => Promise<CacheSafeParams>
  runFork?: (params: Parameters<typeof runForkedAgent>[0]) => Promise<ForkedAgentResult>
}

function stripInProgressAssistantMessage(
  messages: LocalJSXCommandContext['messages'],
): LocalJSXCommandContext['messages'] {
  const last = messages.at(-1)
  if (last?.type === 'assistant' && last.message.stop_reason === null) {
    return messages.slice(0, -1)
  }
  return messages
}

async function buildCacheSafeParams(
  context: LocalJSXCommandContext,
  deps: ForkCommandDeps,
): Promise<CacheSafeParams> {
  const forkContextMessages = stripInProgressAssistantMessage(context.messages)
  const saved = (deps.getSavedCacheSafeParams ?? getLastCacheSafeParams)()

  if (saved) {
    return {
      systemPrompt: saved.systemPrompt,
      userContext: saved.userContext,
      systemContext: saved.systemContext,
      toolUseContext: context,
      forkContextMessages,
    }
  }

  return (deps.buildFallbackCacheSafeParams ??
    (fallbackContext =>
      buildSideQuestionFallbackParams({
        tools: fallbackContext.options.tools,
        commands: fallbackContext.options.commands,
        mcpClients: fallbackContext.options.mcpClients,
        messages: fallbackContext.messages,
        readFileState: fallbackContext.readFileState,
        getAppState: fallbackContext.getAppState,
        setAppState: fallbackContext.setAppState,
        customSystemPrompt: fallbackContext.options.customSystemPrompt,
        appendSystemPrompt: fallbackContext.options.appendSystemPrompt,
        thinkingConfig: fallbackContext.options.thinkingConfig,
        agents: fallbackContext.options.agentDefinitions.activeAgents,
      })))(context)
}

export async function executeForkCommand(
  args: string,
  context: LocalJSXCommandContext,
  deps: ForkCommandDeps = {},
): Promise<LocalCommandResult> {
  const directive = args.trim()
  if (!directive) {
    return {
      type: 'text',
      value: 'Usage: /fork <directive>',
    }
  }

  const cacheSafeParams = await buildCacheSafeParams(context, deps)
  const result = await (deps.runFork ?? runForkedAgent)({
    promptMessages: [createUserMessage({ content: buildChildMessage(directive) })],
    cacheSafeParams,
    canUseTool: hasPermissionsToUseTool,
    querySource: 'agent:custom',
    forkLabel: 'slash_fork',
    maxTurns: 200,
  })

  return {
    type: 'text',
    value: extractResultText(result.messages, 'Fork completed.'),
  }
}

export async function call(
  args: string,
  context: LocalJSXCommandContext,
): Promise<LocalCommandResult> {
  return executeForkCommand(args, context)
}
