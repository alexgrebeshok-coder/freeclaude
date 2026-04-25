---
name: freeclaude-session-tree
description: "Branch/fork sessions to explore alternative paths without losing the original. Use when you want to A/B two refactors, or save a checkpoint before a risky edit."
trigger_modes: [ralph, quest]
metadata:
  openclaw:
    emoji: "🌳"
    category: "session-management"
---

# FreeClaude Session Tree

The Session Tree feature lets you **fork** a FreeClaude session at a turn
checkpoint and explore multiple diverging branches without discarding the
original context.

---

## When to Fork

- **Risky edit** — you are about to apply a change that is hard to undo
  (database migration, destructive refactor, dependency upgrade).  Fork first,
  then proceed.  If things go wrong, the original branch is intact.
- **A/B comparison** — you want to try two different implementation strategies
  and compare outcomes before deciding which to keep.
- **"What if" exploration** — you want to answer a hypothetical ("what if I
  switch to ESM?") without polluting the main session.

---

## Branch Lifecycle

```
created → active → merged | abandoned
```

| State       | Meaning                                               |
|-------------|-------------------------------------------------------|
| `created`   | Branch record exists; no task has run against it yet  |
| `active`    | A task is running (or has run) inside the branch      |
| `merged`    | Changes were accepted and applied to the main session |
| `abandoned` | Branch was discarded; prune it to free disk space     |

Lifecycle state is tracked informally via the `notes` field in the branch
record.  Update it with `session-tree annotate` (or directly in the JSON file)
to keep a clear audit trail.

---

## Naming Convention

Use hierarchical slash-names so branches are easy to filter and sort:

| Prefix      | Use case                                      |
|-------------|-----------------------------------------------|
| `feat/<topic>` | New feature exploration                    |
| `fix/<topic>`  | Targeted bug-fix branch                    |
| `try/<topic>`  | Experimental / throwaway branch            |
| `ab/<label>`   | One side of an A/B comparison              |

Examples: `feat/esm-migration`, `fix/timeout-crash`, `try/new-scorer`,
`ab/strategy-a`, `ab/strategy-b`.

---

## How to Fork

```bash
# Create a branch and run a task on the fork in one step:
tools/fc-fork.sh \
  --session <SESSION_ID> \
  --task "Refactor auth module to use JWT" \
  --from-turn 12 \
  --name feat/jwt-auth \
  --workdir /path/to/project

# Or just register the branch record without running a task:
bun run scripts/session-tree.ts fork \
  --session <SESSION_ID> \
  --from-turn 12 \
  --name try/dry-run
```

The fork command prints `BRANCH_ID=<id>` to stdout.

---

## Listing and Inspecting

```bash
# All sessions
bun run scripts/session-tree.ts list-sessions

# Branches under a session
bun run scripts/session-tree.ts list --session <SESSION_ID>

# Full branch details
bun run scripts/session-tree.ts info --branch <BRANCH_ID>

# Export branch JSON
bun run scripts/session-tree.ts export --branch <BRANCH_ID>
```

---

## Comparing Branches

When two branches ran in **separate workdirs**:

```bash
diff -rq /path/to/workdir-A /path/to/workdir-B
```

When both branches shared the same workdir, retrieve their recorded outputs
from the FreeClaude session envelopes stored inside each branch record
(`fcSessionId`) and compare the text / code blocks produced.

---

## Cleanup

Branches accumulate over time.  Clean up periodically:

```bash
# Keep the 5 most recent branches for a session
bun run scripts/session-tree.ts prune --session <SESSION_ID> --keep 5

# Remove orphaned branch files (no parent index.json)
bun run scripts/session-tree.ts gc
```

---

## Output Contract

| Command  | Output (stdout)                                      |
|----------|------------------------------------------------------|
| `fork`   | `BRANCH_ID=<id>` (one line)                          |
| `list`   | Table rows + `BRANCHES_LIST=<N>` (last line)         |
| `list-sessions` | Session IDs + `SESSIONS_LIST=<N>` (last line) |

Scripts that consume these outputs should grep for the `KEY=VALUE` line and
extract the value with `cut -d= -f2`.

---

## Storage Layout

```
~/.freeclaude/sessions/
  <session-id>/
    index.json          # session metadata + branch index
    branches/
      <branch-id>.json  # full branch record
```

Override the base directory with the `FREECLAUDE_HOME` environment variable.
