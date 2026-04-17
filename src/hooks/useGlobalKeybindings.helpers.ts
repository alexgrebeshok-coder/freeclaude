export function getNextExpandedView(
  currentView: 'none' | 'tasks' | 'teammates',
  hasTeammates: boolean,
): 'none' | 'tasks' | 'teammates' {
  if (hasTeammates) {
    switch (currentView) {
      case 'none':
        return 'tasks'
      case 'tasks':
        return 'teammates'
      case 'teammates':
        return 'none'
    }
  }

  return currentView === 'tasks' ? 'none' : 'tasks'
}
