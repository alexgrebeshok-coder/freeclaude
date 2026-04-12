import type { Command } from '../../commands.js'

const forget = {
  type: 'local',
  name: 'forget',
  description: 'Delete a memory. Usage: /forget <key>',
  supportsNonInteractive: false,
  load: () => import('./forget.js'),
} satisfies Command

export default forget
