import type { Command } from '../../commands.js'

const recall = {
  type: 'local',
  name: 'recall',
  description: 'Retrieve a memory. Usage: /recall <key|query>',
  supportsNonInteractive: false,
  load: () => import('./recall.js'),
} satisfies Command

export default recall
