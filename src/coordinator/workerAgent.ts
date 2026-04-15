import { ASYNC_AGENT_ALLOWED_TOOLS } from '../constants/tools.js'
import {
  BASH_TOOL_NAME,
} from '../tools/BashTool/toolName.js'
import {
  FILE_EDIT_TOOL_NAME,
} from '../tools/FileEditTool/constants.js'
import {
  FILE_READ_TOOL_NAME,
} from '../tools/FileReadTool/prompt.js'
import type {
  AgentDefinition,
  BuiltInAgentDefinition,
} from '../tools/AgentTool/loadAgentsDir.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { isCoordinatorMode } from './coordinatorMode.js'

function getCoordinatorWorkerTools(): string[] {
  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    return [BASH_TOOL_NAME, FILE_READ_TOOL_NAME, FILE_EDIT_TOOL_NAME]
  }

  return Array.from(ASYNC_AGENT_ALLOWED_TOOLS).sort()
}

function getCoordinatorWorkerSystemPrompt(): string {
  return `You are a worker agent for FreeClaude. You execute tasks delegated by a coordinator, not by the end user.

Your job is to complete the assigned scope directly with the tools available to you and return a concise handoff.

Rules:
- Work only on the delegated scope
- Use tools directly; do not ask the user follow-up questions
- Do not spawn additional agents
- If you change files, say which files changed
- If you run validation, report the concrete outcome
- End with a concise summary of what you found or changed`
}

export const COORDINATOR_WORKER_AGENT: BuiltInAgentDefinition = {
  agentType: 'worker',
  whenToUse:
    'Coordinator-mode worker for delegated research, implementation, and verification tasks.',
  tools: getCoordinatorWorkerTools(),
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: getCoordinatorWorkerSystemPrompt,
}

export function getCoordinatorAgents(): AgentDefinition[] {
  return isCoordinatorMode() ? [COORDINATOR_WORKER_AGENT] : []
}

export const workerAgent = {
  isAvailable: () => isCoordinatorMode(),
  spawn: () => {
    throw new Error('Use the Agent tool to spawn coordinator workers')
  },
}
