/**
 * FreeClaude v3 — /model Command
 *
 * Switch between configured providers and models.
 */

import type { Command } from '../../commands.js'

const command = {
  type: 'local',
  name: 'model',
  description: 'Switch AI provider/model (/model <number|name>)',
  supportsNonInteractive: false,
  load: () => import('./model.js'),
} satisfies Command

export default command
