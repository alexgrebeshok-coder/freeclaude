export type TeammateSelectionState = {
  expandedView: 'none' | 'teammates' | 'tasks'
  viewSelectionMode: 'none' | 'selecting-agent' | 'viewing-agent'
  selectedIPAgentIndex: number
}

export function getNextTeammateSelectionState(
  currentState: TeammateSelectionState,
  teammateCount: number,
  delta: 1 | -1,
): TeammateSelectionState {
  if (teammateCount === 0) {
    return currentState
  }

  if (currentState.expandedView !== 'teammates') {
    return {
      ...currentState,
      expandedView: 'teammates',
      viewSelectionMode: 'selecting-agent',
      selectedIPAgentIndex: -1,
    }
  }

  const maxIdx = teammateCount
  const cur = currentState.selectedIPAgentIndex
  const next =
    delta === 1 ? (cur >= maxIdx ? -1 : cur + 1) : cur <= -1 ? maxIdx : cur - 1

  return {
    ...currentState,
    selectedIPAgentIndex: next,
    viewSelectionMode: 'selecting-agent',
  }
}
