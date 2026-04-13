/**
 * FreeClaude v3 — /setup Command (local)
 *
 * Manage providers directly inside FreeClaude REPL.
 * Quick-add, browse, remove — no external terminal needed.
 */

import type { Command } from '../../commands.js'

const command = {
  type: 'local',
  name: 'setup',
  description: 'Add/remove AI providers (/setup, /setup zai, /setup free, /setup add 1 key)',
  supportsNonInteractive: true,
  load: () => import('./setup.js'),
} satisfies Command

export default command
