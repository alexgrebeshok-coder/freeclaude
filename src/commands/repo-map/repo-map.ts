import type { LocalCommandCall } from '../../types/command.js'
import { generateRepoMap } from '../../tools/GitTool/gitToolUtils.js'

export const call: LocalCommandCall = async args => {
  const rawDepth = Number.parseInt(args.trim() || '4', 10)
  const maxDepth = Number.isFinite(rawDepth) ? rawDepth : 4
  const result = await generateRepoMap({ maxDepth })

  return {
    type: 'text',
    value: result.output,
  }
}
