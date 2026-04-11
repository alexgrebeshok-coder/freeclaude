/**
 * FreeClaude v3 — Default Hooks
 *
 * Pre-configured hooks for FreeClaude that provide
 * safety, quality, and convenience out of the box.
 *
 * Hooks are shell commands that run at specific lifecycle events:
 * - PreToolUse: before a tool executes
 * - PostToolUse: after a tool executes
 * - PostToolUseFailure: after a tool fails
 * - PermissionDenied: after auto-mode denies a tool
 * - Notification: when agent needs user attention
 *
 * These are suggested defaults — users can override in their config.
 */

export interface FreeClaudeHook {
  event: string
  name: string
  description: string
  matcher?: string        // tool name or pattern to match
  command: string
  enabled: boolean
}

/**
 * Default FreeClaude hooks.
 * These enhance safety and UX without requiring user configuration.
 */
export const DEFAULT_HOOKS: FreeClaudeHook[] = [
  // ---- Safety Hooks ----

  {
    event: 'PreToolUse',
    name: 'prevent-secret-commit',
    description: 'Warn when committing files that may contain secrets',
    matcher: 'Bash',
    command: `echo "$1" | jq -r '.command // empty' | grep -qE 'git (commit|add)' && {
      git diff --cached --name-only 2>/dev/null | grep -qE '\\.(env|credentials|secret|key|pem|p12|pfx)' && {
        echo "⚠️ WARNING: You may be committing files that contain secrets." >&2
        exit 2  # Block and show to model
      }
    }
    exit 0`,
    enabled: true,
  },

  {
    event: 'PreToolUse',
    name: 'prevent-rm-without-trash',
    description: 'Block rm -rf commands, suggest trash instead',
    matcher: 'Bash',
    command: `echo "$1" | jq -r '.command // empty' | grep -qE 'rm (-[rfRF]+ |--force |--recursive).*' && {
      echo "⚠️ BLOCKED: Use 'trash' instead of 'rm' for recoverable deletion." >&2
      exit 2
    }
    exit 0`,
    enabled: true,
  },

  // ---- Quality Hooks ----

  {
    event: 'PostToolUse',
    name: 'auto-format-check',
    description: 'Suggest formatting after editing code files',
    matcher: 'Write',
    command: `echo "$1" | jq -r '.response.file_path // empty' | grep -qE '\\.(ts|tsx|js|jsx|py|go|rs)$' && {
      echo "💡 Tip: Consider running formatter on this file." >&2
    }
    exit 0`,
    enabled: true,
  },

  // ---- Git Hooks ----

  {
    event: 'PostToolUse',
    name: 'git-commit-tracker',
    description: 'Track AI-generated commits for /undo',
    matcher: 'Bash',
    command: `echo "$1" | jq -r '.command // empty' | grep -qE '^git commit' && {
      COMMIT_SHA=$(echo "$1" | jq -r '.response.stdout // empty' | grep -oE '[a-f0-9]{7,}' | head -1)
      if [ -n "$COMMIT_SHA" ]; then
        echo "$COMMIT_SHA" >> /tmp/freeclaude-ai-commits.txt
      fi
    }
    exit 0`,
    enabled: true,
  },

  // ---- Notification Hooks ----

  {
    event: 'Notification',
    name: 'long-task-notify',
    description: 'Notify when a task takes longer than 5 minutes',
    matcher: '*',
    command: `# Placeholder: shell notification on long tasks
exit 0`,
    enabled: false,
  },
]

/**
 * Get enabled default hooks.
 */
export function getEnabledDefaultHooks(): FreeClaudeHook[] {
  return DEFAULT_HOOKS.filter(h => h.enabled)
}

/**
 * Get hooks as a config object for hooksConfigManager.
 */
export function getDefaultHooksConfig(): Record<string, Array<{
  command: string
  description: string
}>> {
  const config: Record<string, Array<{ command: string; description: string }>> = {}

  for (const hook of DEFAULT_HOOKS) {
    if (!hook.enabled) continue

    const key = hook.matcher
      ? `${hook.event}:${hook.matcher}`
      : hook.event

    if (!config[key]) config[key] = []

    config[key].push({
      command: hook.command,
      description: `${hook.name}: ${hook.description}`,
    })
  }

  return config
}
