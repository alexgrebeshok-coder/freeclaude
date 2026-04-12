/**
 * FreeClaude v3 — /run Command
 *
 * Run a task in the background using the AI agent.
 * Usage: /run <prompt> [--timeout <seconds>] [--model <model>]
 */

import type { Command } from '../../commands.js'

const run = {
  type: 'local',
  name: 'run',
  description: 'Run an AI task in the background. Usage: /run <prompt>',
  supportsNonInteractive: false,
  load: () => import('./run.js'),
} satisfies Command

export default run
