---
name: freeclaude-plugin
description: "Use the FreeClaude plugin runtime instead of raw shell commands when delegating coding tasks."
metadata:
  {
    "openclaw": {
      "emoji": "⚡",
      "category": "coding"
    }
  }
---

# FreeClaude Plugin Runtime

Prefer the **`freeclaude_run`** tool when you need a coding specialist.

## When to Use

- feature work
- debugging
- refactors
- code review
- test generation
- code explanation

## Preferred Interfaces

1. **`freeclaude_run` tool** — best default for agent delegation
2. **FreeClaude MCP tools** — good when the MCP server is available
3. **`/fc ...` command** — for direct operator use

## Tool Guidance

Pass:
- `task`
- `workdir`
- `mode` (`code`, `review`, `debug`, `explain`, `test`, `refactor`)
- optional `model`
- optional `timeout`
- optional `background=true` for long-running runs
- optional `sessionKey` for session-native continuity inside OpenClaw
- optional `resume=false` to force a fresh FreeClaude session
- optional `resumeSessionId` to explicitly resume a known FreeClaude session
- optional `retryRunId` to retry a stored run

Keep `includeMemory` enabled unless the task explicitly needs a cold run.

## Background Runs

For long-running work, prefer:

1. `freeclaude_run(background=true, ...)`
2. poll with `freeclaude_run_status`
3. cancel with `freeclaude_run_cancel` if needed
4. inspect recent runs with `freeclaude_run_list`
5. inspect stored session bindings with `freeclaude_session_list`

Both list tools accept optional filters like `status`, `mode`, `sessionKey`, `workdir`, `query`, and `limit`.

Operator command equivalents:

```text
/fc start ...
/fc poll <runId>
/fc result <runId>
/fc cancel <runId>
/fc retry <runId>
/fc runs
/fc runs --status failed --query retry
/fc sessions
/fc sessions --session team-telegram
```

## Safety

- never point it at `~/.openclaw/` unless the operator explicitly wants that
- always use the real project directory
- prefer specific tasks over vague requests

## Modes

- `code`     — single-pass coding (default)
- `quest`    — spec-driven async execution (see QUEST.md)
- `ralph`    — verify→fix loop until score ≥ threshold (see RALPH.md)
- `review`   — read-only audit (Reviewer hat, no file edits)
- `debug`    — diagnostics + minimal targeted fix
- `explain`  — explanation only, no edits
- `test`     — author and/or run tests
- `refactor` — structure-preserving change, behaviour unchanged

## Loaded protocols

The following skill files extend FreeClaude with structured execution protocols:

- [`RALPH.md`](RALPH.md) — iterative PLAN→CODE→VERIFY→FIX loop with script-based
  scoring, struggle detection, and context rotation.
- [`QUEST.md`](QUEST.md) — spec-driven async execution across SPEC→PLAN→CODE→TEST
  →VALIDATE→REPORT stages with checkpointing and milestone notifications.
- [`HATS.md`](HATS.md) — multi-perspective hat system (Planner / Coder / Tester /
  Reviewer) used within Ralph and Quest to enforce role separation.
- [`SESSION_TREE.md`](SESSION_TREE.md) — branch/fork sessions to explore
  alternative paths without losing the original checkpoint.
