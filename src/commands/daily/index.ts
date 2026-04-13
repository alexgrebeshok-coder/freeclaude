import type { Command } from '../../commands.js'

const daily = {
  type: 'local',
  name: 'daily',
  description: 'Daily notes — write/read session summaries. Usage: /daily [text] or /daily show [date]',
  supportsNonInteractive: true,
  load: () => import('./daily.js'),
} satisfies Command

export default daily
