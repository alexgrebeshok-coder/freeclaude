import type { Command } from '../../commands.js'

const routine = {
  type: 'local',
  name: 'routine',
  description:
    'Manage routines. Usage: /routine <create|list|show|run|update|delete|logs|enable|disable> ...',
  supportsNonInteractive: true,
  load: () => import('./routine.js'),
} satisfies Command

export default routine
