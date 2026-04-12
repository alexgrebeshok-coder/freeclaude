/**
 * FreeClaude v3 — /providers Command
 *
 * Show current provider configuration and test connectivity.
 */

import type { Command } from '../../commands.js'

const command = {
  type: 'local',
  name: 'providers',
  description: 'Show provider configuration and test connectivity',
  supportsNonInteractive: true,
  load: () => import('./providers.js'),
} satisfies Command

export default command
