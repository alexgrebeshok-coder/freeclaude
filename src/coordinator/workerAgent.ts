/**
 * FreeClaude — Worker Agent stub
 * Inherited from Claude Code; subagent orchestration handled by agentBridge instead.
 */
export function getCoordinatorAgents(): [] {
  return []
}

export const workerAgent = {
  isAvailable: () => false,
  spawn: () => { throw new Error('workerAgent not available in FreeClaude') },
}
