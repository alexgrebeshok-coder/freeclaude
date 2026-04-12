import type { LocalCommandCall } from '../../types/command.js'
import { undoRecentCommits } from '../../tools/GitTool/gitToolUtils.js'

export const call: LocalCommandCall = async args => {
  const rawCount = Number.parseInt(args.trim() || '1', 10)
  const count = Number.isFinite(rawCount) ? rawCount : 1
  const result = await undoRecentCommits(count)

  return {
    type: 'text',
    value: result.output,
  }
}
