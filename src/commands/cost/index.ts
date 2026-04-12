/**
 * FreeClaude v3 — /cost Command
 */

import type { Command } from '../../commands.js'

const command = {
  type: 'local',
  name: 'cost',
  description: 'Show cost tracking summary. Usage: /cost [today|week|month|clear]',
  supportsNonInteractive: true,
  load: () => import('./cost.js'),
} satisfies Command

export default command
