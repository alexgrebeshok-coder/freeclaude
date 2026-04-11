/**
 * FreeClaude v3 — /undo Command
 *
 * Rollback the last commit (soft reset, keeping changes staged).
 * Usage: /undo [count]
 *   count: number of commits to undo (default: 1)
 */

import type { Command } from '../../commands.js'
import { executeShellCommandsInPrompt } from '../../utils/promptShellExecution.js'

const ALLOWED_TOOLS = [
  'Bash(git log:*)',
  'Bash(git reset:*)',
  'Bash(git status:*)',
]

function getPromptContent(args: string[]): string {
  const count = parseInt(args[0] || '1', 10) || 1
  const validatedCount = Math.min(Math.max(count, 1), 50) // clamp 1-50

  return `## Context

- Last ${validatedCount} commit(s): \`git log --oneline -${validatedCount + 5}\`
- Current branch: \`git branch --show-current\`

## Your Task

The user wants to undo the last ${validatedCount} commit(s).

1. Show the commit(s) that will be undone
2. Run \`git reset --soft HEAD~${validatedCount}\` to undo (keeps changes staged)
3. Show the current status

IMPORTANT:
- Use \`--soft\` reset (keeps all changes staged, nothing is lost)
- Do NOT use \`--hard\` (that would lose changes)
- If there are fewer than ${validatedCount} commits, warn the user and do nothing
- Do NOT skip hooks or amend commits`
}

const command = {
  type: 'prompt',
  name: 'undo',
  description: 'Undo the last commit (soft reset, keeps changes staged)',
  allowedTools: ALLOWED_TOOLS,
  contentLength: 0,
  progressMessage: 'undoing commit',
  source: 'builtin',
  async getPromptForCommand(args, context) {
    const promptContent = getPromptContent(args)

    const finalContent = await executeShellCommandsInPrompt(
      promptContent,
      {
        ...context,
        getAppState() {
          const appState = context.getAppState()
          return {
            ...appState,
            toolPermissionContext: {
              ...appState.toolPermissionContext,
              alwaysAllowRules: {
                ...appState.toolPermissionContext.alwaysAllowRules,
                command: ALLOWED_TOOLS,
              },
            },
          }
        },
      },
      '/undo',
    )

    return [{ type: 'text', text: finalContent }]
  },
} satisfies Command

export default command
