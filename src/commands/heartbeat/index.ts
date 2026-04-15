import type { Command } from '../../commands.js'

const heartbeat = {
  type: 'local',
  name: 'heartbeat',
  description: 'System health check — providers, memory, tasks, disk. Usage: /heartbeat [maintain]',
  supportsNonInteractive: true,
  load: () => import('./heartbeat.js'),
} satisfies Command

export default heartbeat
