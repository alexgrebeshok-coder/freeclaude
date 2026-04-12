/**
 * FreeClaude v3 — /jobs Command
 *
 * List all background tasks with their status.
 */

import type { Command } from '../../commands.js'

const jobs = {
  type: 'local',
  name: 'jobs',
  description: 'List all background tasks',
  supportsNonInteractive: false,
  load: () => import('./jobs.js'),
} satisfies Command

export default jobs
