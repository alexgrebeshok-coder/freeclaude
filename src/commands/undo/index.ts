import type { Command } from '../../commands.js'

const undo = {
  type: 'local',
  name: 'undo',
  description: 'Undo the last commit (soft reset, keeps changes staged)',
  supportsNonInteractive: false,
  load: () => import('./undo.js'),
} satisfies Command

export default undo
