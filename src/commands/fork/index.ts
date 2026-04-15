import type { Command } from '../../commands.js'

const fork = {
  type: 'local',
  name: 'fork',
  description:
    'Forked Anthropic subagents are not supported in FreeClaude yet. Use the task or agent workflow instead.',
  supportsNonInteractive: false,
  load: () => import('./fork.js'),
} satisfies Command

export function register(): void {
  // Legacy no-op kept for compatibility with the original stub.
}

export default fork
