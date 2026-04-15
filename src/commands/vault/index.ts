import type { Command } from '../../commands.js'

const vault = {
  type: 'local',
  name: 'vault',
  description: 'Manage vault notes. Usage: /vault [list|show|search|pin|archive|forget|new|open]',
  supportsNonInteractive: true,
  load: () => import('./vault.js'),
} satisfies Command

export default vault
