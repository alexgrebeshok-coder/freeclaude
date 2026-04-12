import type { Command } from '../../commands.js'

const remember = {
  type: 'local',
  name: 'remember',
  description: 'Save a fact to memory. Usage: /remember <key> <value> [tag1,tag2]',
  supportsNonInteractive: false,
  load: () => import('./remember.js'),
} satisfies Command

export default remember
