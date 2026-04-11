/**
 * FreeClaude v3 — /repo-map Command
 *
 * Generate a concise map of the repository structure.
 * Shows directories, key files, and tech stack.
 */

import type { Command } from '../../commands.js'
import { executeShellCommandsInPrompt } from '../../utils/promptShellExecution.js'

const ALLOWED_TOOLS = [
  'Bash(find:*)',
  'Bash(head:*)',
  'Bash(wc:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(tree:*)',
]

function getPromptContent(): string {
  return `## Context

- Repository root: current directory
- Top-level structure: \`ls -la\`
- Directory tree (3 levels): \`find . -maxdepth 3 -type d | grep -v node_modules | grep -v .git | grep -v dist | sort\`
- Key config files: \`ls package.json tsconfig.json *.config.* 2>/dev/null\`
- File count by type: \`find . -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.py' | grep -v node_modules | grep -v .git | sed 's/.*\\.//' | sort | uniq -c | sort -rn | head -10\`

## Your Task

Generate a concise repository map:

1. **Tech Stack** — identify language, framework, build tool
2. **Directory Structure** — tree of top-level directories (3 levels, exclude node_modules/.git/dist)
3. **Key Files** — config files, entry points, README
4. **File Stats** — count by type
5. **Project Type** — library, app, CLI, etc.

Format as a readable tree with annotations. Keep it concise (under 100 lines).

Do NOT read file contents (except config file names). Just list the structure.`
}

const command = {
  type: 'prompt',
  name: 'repo-map',
  description: 'Show repository structure map',
  allowedTools: ALLOWED_TOOLS,
  contentLength: 0,
  progressMessage: 'generating repo map',
  source: 'builtin',
  async getPromptForCommand(_args, context) {
    const promptContent = getPromptContent()

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
      '/repo-map',
    )

    return [{ type: 'text', text: finalContent }]
  },
} satisfies Command

export default command
