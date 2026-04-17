import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'

export function shouldAttemptSpeculativeBashClassifier({
  pendingClassifierCheck,
  toolName,
  awaitAutomatedChecksBeforeDialog,
}: {
  pendingClassifierCheck: unknown
  toolName: string
  awaitAutomatedChecksBeforeDialog: boolean
}): boolean {
  return (
    Boolean(pendingClassifierCheck) &&
    toolName === BASH_TOOL_NAME &&
    !awaitAutomatedChecksBeforeDialog
  )
}
