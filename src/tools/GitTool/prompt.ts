import { GIT_TOOL_NAME } from './constants.js'

export const DESCRIPTION =
  'Inspect repository state, generate a lightweight repo map, create focused commits, or undo recent commits.'

export function getPrompt(): string {
  return `Use ${GIT_TOOL_NAME} for git-aware repository operations that do not require invoking the shell directly.

Supported operations:
- status: show current branch, uncommitted changes, and recent commits
- diff: show the diff since the last commit (HEAD), including untracked files in the status summary
- repo_map: generate a tree-sitter-free repository map with directories, file sizes, and key exports
- undo: roll back the last commit(s) with a soft reset, keeping changes in the working tree
- auto_commit: stage and commit the provided file path(s) with a generated message

Guidelines:
- Prefer status or diff when you need fresh repository context
- Use repo_map instead of shelling out to tree/find when you want a concise structural overview
- Use undo only for local rollback of recent commits
- Use auto_commit only after files were intentionally changed`
}
