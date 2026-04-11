/**
 * FreeClaude v3 — /setup Command
 *
 * Interactive provider setup wizard.
 * Auto-detects available providers and configures fallback chain.
 */

import type { Command } from '../../commands.js'
import { executeShellCommandsInPrompt } from '../../utils/promptShellExecution.js'

const ALLOWED_TOOLS = [
  'Bash(curl:*)',
  'Bash(cat:*)',
  'Bash(node:*)',
]

function getPromptContent(): string {
  return `## Context

- Config file: \`cat ~/.freeclaude.json\`
- Current providers: \`cat ~/.freeclaude.json | grep -E '"name"|"baseUrl"|"model"' 2>/dev/null\`
- Test ZAI: \`curl -s --max-time 10 https://api.z.ai/api/coding/paas/v4/models -H "Authorization: Bearer $OPENAI_API_KEY" | head -5\`
- Test Ollama: \`curl -s --max-time 5 http://localhost:11434/v1/models | head -5\`
- Test Gemini: \`curl -s --max-time 10 https://generativelanguage.googleapis.com/v1beta/openai/models -H "Authorization: Bearer $GEMINI_API_KEY" | head -5\`

## Your Task

Help the user configure FreeClaude providers:

1. Check what's already configured in ~/.freeclaude.json
2. Test which providers are reachable (ZAI, Ollama, Gemini, OpenRouter)
3. If no config exists, offer to create one with detected providers
4. If config exists, show current setup and offer improvements

Format the output as a clear status table:
- Provider name | Status | Model | Latency | Notes

For each provider, try a simple test request to verify connectivity.

The config file format:
\`\`\`json
{
  "providers": [
    {
      "name": "zai",
      "baseUrl": "https://api.z.ai/api/coding/paas/v4",
      "apiKey": "key-here",
      "model": "glm-4.7-flash",
      "priority": 1,
      "timeout": 30000
    }
  ]
}
\`\`\``
}

const command = {
  type: 'prompt',
  name: 'setup',
  description: 'Configure FreeClaude providers (auto-detect)',
  allowedTools: ALLOWED_TOOLS,
  contentLength: 0,
  progressMessage: 'detecting providers',
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
      '/setup',
    )

    return [{ type: 'text', text: finalContent }]
  },
} satisfies Command

export default command
