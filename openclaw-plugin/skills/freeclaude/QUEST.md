---
name: freeclaude-quest-mode
description: "Spec-driven asynchronous execution: SPEC → PLAN → CODE → TEST → VALIDATE → REPORT. Use for long features/refactors where the user provides a spec doc."
trigger_modes: [quest]
metadata:
  openclaw:
    emoji: "🗺️"
    category: "coding-orchestration"
---

# Quest Mode Protocol

## Purpose

Quest runs a long, multi-stage task from a spec document without requiring the
user to micromanage each step. Execution is async-friendly: each stage
checkpoints state so the task can pause, resume, or be cancelled cleanly.

**Use Quest when:**

- A feature spans multiple files and will take >15 minutes
- A refactor requires careful sequencing of subtasks
- The user provides (or can co-author) a structured spec document
- You need milestone notifications rather than a single final answer

---

## Spec Contract

Before starting, verify the spec file contains **all** of these sections:

- `## Goal` — 1-3 sentence objective
- `## Constraints` — performance, deps, compatibility limits
- `## Files` — bullet list of files to create or modify
- `## Acceptance criteria` — Gherkin-style or checklist items
- `## Edge cases` — known boundary conditions

If any section is missing: **stop, request the spec be completed, do not
assume values.** Use `templates/spec-template.md` as the reference.

---

## Stages

1. **SPEC** — Parse the spec. Acknowledge ambiguities explicitly. List any
   constraints that conflict. Await user confirmation before proceeding.
   Assign a `quest_id` (slug from Goal text + timestamp).

2. **PLAN** — Decompose into ≤12 numbered subtasks. Each subtask must be
   independently verifiable. Emit the plan and **await user acknowledgement**
   before coding begins.

3. **CODE** — Execute one subtask at a time. Each change should be
   commit-sized: coherent, reviewable, and self-contained. Do not batch
   multiple subtasks into one diff without flagging it.

4. **TEST** — After each subtask: run the relevant tests plus `scripts/score.sh`.
   Record pass/fail per subtask in the quest state file.

5. **VALIDATE** — After all subtasks: verify every acceptance criterion from
   the spec is satisfied. Mark each criterion `✅ done`, `⚠️ partial`,
   or `❌ blocked` with a one-line rationale.

6. **REPORT** — Emit a markdown summary (see Output Contract). Notify the user.

---

## Notification Points

Pause and notify the user at:

- End of **SPEC** (ambiguity list + awaiting ack)
- End of **PLAN** (subtask list + awaiting ack)
- Any **blocker** encountered mid-CODE (missing dep, conflicting constraint)
- End of **REPORT**

Do not notify on every subtask unless a blocker is hit.

---

## Failure Modes & Checkpointing

If a stage exceeds token budget or time limit:

1. Write current state to `~/.freeclaude/quests/<quest_id>.json`:
   ```json
   { "id": "<quest_id>", "stage": "<current>", "subtasks_done": N,
     "subtasks_total": M, "last_error": "...", "timestamp": "..." }
   ```
2. Emit a clean exit message with resume instructions.
3. Never leave files in a partially-modified state without noting which files
   were touched and what remains.

---

## Output Contract

Every Quest run ends with:

```
QUEST_REPORT id=<quest_id> status=ok|partial|blocked stages_done=N/M
```

Followed by the markdown REPORT section containing:

- **Done** — subtasks completed with acceptance criteria met
- **Partial** — subtasks completed but criteria only partially met
- **Blocked** — subtasks not started or halted, with reason and next action

---

## Anti-Patterns

- **Do not** start coding before the spec is validated and the plan is ack'd.
- **Do not** combine multiple subtasks into one commit without explicit notice.
- **Do not** silently skip acceptance criteria that are hard to verify.
- **Do not** delete or weaken tests to reach `status=ok`.
- **Do not** assume missing spec sections — always ask.

---

## Doc context

Quest mode CAN be primed with extracted TSDoc/JSDoc before invocation so the
agent receives accurate signatures and author intent without paying tokens to
re-read every source file.

### Recommended workflow

```sh
# 1. Extract doc comments from your source tree into Markdown:
bun run scripts/extract-doc.ts \
  --workdir . --include "src/**" --format md \
  > /tmp/doc-context.md

# 2. Prepend the doc context to your spec, then invoke Quest:
tools/quest-with-docs.sh --spec docs/my-spec.md --workdir .
```

Or use the convenience wrapper directly (it handles step 1 & 2 automatically):

```sh
tools/quest-with-docs.sh \
  --spec docs/my-spec.md \
  --workdir . \
  --include "src/**" \
  --symbols "MyClass,MyClass.myMethod"
```

### Why this helps

- **Accurate signatures**: the agent sees the real parameter types and return
  types instead of guessing from usage.
- **Author intent**: `@param` / `@returns` / `@throws` tags encode behaviour
  that is not always obvious from the implementation.
- **Token efficiency**: a compact Markdown summary is much smaller than
  re-reading every file from disk inside the conversation context.

### Extractor limitations

- When the TypeScript compiler API is unavailable, a regex fallback is used;
  signatures and tags may be approximate.
- Glob patterns do **not** support brace expansions (`{a,b}`).
- Only `*.ts`, `*.tsx`, `*.js`, `*.mjs` files are scanned.
