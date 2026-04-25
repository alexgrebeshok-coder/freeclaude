# Quest Mode — Stage Prompt Template

> This template is injected by the FreeClaude wrapper at the top of each
> Quest stage prompt. Variables use `{{var}}` syntax.

---

## Active Quest

- **Spec file:** `{{spec_path}}`
- **Current stage:** `{{stage}}`
- **Previous stage output:**

```
{{previous_stage_output}}
```

---

## Your Job This Stage

Follow the Quest Mode protocol defined in `QUEST.md`. Your responsibilities
for **`{{stage}}`** are:

| Stage    | Job                                                          |
|----------|--------------------------------------------------------------|
| SPEC     | Parse spec, list ambiguities, await user ack.               |
| PLAN     | Emit ≤12 numbered subtasks, await user ack.                 |
| CODE     | Implement one subtask at a time; commit-sized diffs only.   |
| TEST     | Run tests + `scripts/score.sh`; report pass/fail precisely. |
| VALIDATE | Verify every acceptance criterion; mark ✅/⚠️/❌.           |
| REPORT   | Emit markdown summary + `QUEST_REPORT` envelope line.       |

Do only the work for **`{{stage}}`**. Do not advance to the next stage
without explicit instruction or a notification ack from the user.

---

## Stop / Notify Conditions

- **Notify** if you hit a blocker (missing dep, conflicting constraint,
  ambiguous spec section). Do not guess; surface it immediately.
- **Notify** at end of PLAN before any code is written (await ack).
- **Checkpoint** to `~/.freeclaude/quests/<id>.json` if you must exit early.
- **Never** start the CODE stage without a validated spec and an ack'd plan.

---

## Output Contract

End your response with:

```
QUEST_REPORT id=<quest_id> status=ok|partial|blocked stages_done=N/M
```

For intermediate stages, replace the envelope with a stage-completion marker:

```
STAGE_DONE stage={{stage}} status=ok|blocked next=<next_stage>
```

---

## Hat Reminder

Use the **Hat System** (`HATS.md`) to switch perspective between steps:

- Planning work → wear Planner hat
- Writing code → wear Coder hat
- Running tests → wear Tester hat
- Final audit → wear Reviewer hat

Announce every switch: `HAT_SWITCH from=X to=Y reason=Z`
