import type { Command } from '../../commands.js'

const memories = {
  type: 'local',
  name: 'memories',
  description: 'List all stored memories',
  supportsNonInteractive: false,
  load: () => import('./memories.js'),
} satisfies Command

export default memories
