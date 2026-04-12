/**
 * FreeClaude v3 — /job Command
 *
 * View output of a specific background task.
 */

import type { Command } from '../../commands.js'

const job = {
  type: 'local',
  name: 'job',
  description: 'View output of a background task. Usage: /job <id>',
  supportsNonInteractive: false,
  load: () => import('./job.js'),
} satisfies Command

export default job
