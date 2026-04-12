import type { Command } from '../../commands.js'

const repoMap = {
  type: 'local',
  name: 'repo-map',
  description: 'Show a structural repository map',
  supportsNonInteractive: false,
  load: () => import('./repo-map.js'),
} satisfies Command

export default repoMap
