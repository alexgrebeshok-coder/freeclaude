# FreeClaude — Project Instructions

## Agent Usage
When delegating work, use the Agent tool with these types:
- "docs-writer" — for creating documentation files
- "code-fixer" — for diagnosing and fixing bugs
- "researcher" — for codebase analysis (read-only)
- "general-purpose" — for any other task

NEVER invent custom agent types. Only use available agents listed above.

## Git
- Always commit after creating or modifying files
- Commit message format: "type: brief description" (docs:, fix:, feat:, chore:)
- Always push to origin/main after completing a task

## File Exclusions
Skip dist/, *.map, node_modules/, coverage/ — they are in .claudeignore.
Never try to read cli.bundle.mjs or source maps.

## Build
Run `npm run build` after any source code changes to verify the build passes.
