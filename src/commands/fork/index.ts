import type { Command } from '../../commands.js'

const fork = {
  type: 'local',
  name: 'fork',
  description:
    'Fork the current conversation context into a focused worker and give it a directive.',
  supportsNonInteractive: false,
  load: () => import('./fork.js'),
} satisfies Command

export function register(): void {
  // Legacy no-op kept for compatibility with the original stub.
}

export default fork
