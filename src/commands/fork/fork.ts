import type { LocalCommandResult } from '../../types/command.js'

export async function call(): Promise<LocalCommandResult> {
  return {
    type: 'text',
    value:
      'Forked Anthropic subagents are not available in FreeClaude yet. Use /task, the built-in agent workflow, or background tasks instead.',
  }
}
