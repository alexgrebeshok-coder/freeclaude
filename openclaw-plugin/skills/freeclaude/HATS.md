---
name: freeclaude-hat-system
description: "Multi-perspective hats (Planner, Coder, Tester, Reviewer). Switch hats mid-task to avoid blind spots."
trigger_modes: [ralph, quest, review]
metadata:
  openclaw:
    emoji: "🎩"
    category: "coding-orchestration"
---

# Hat System Protocol

Switch hats between Ralph iterations or Quest stages to force a change of
perspective. Each hat has a tight mandate — wearing the wrong hat for a step
is an anti-pattern.

---

## 🗂️ Planner Hat

**Wear when:** Starting a Ralph PLAN step or Quest SPEC/PLAN stage.

**Mandate:** Decompose the task into numbered, independently-verifiable
subtasks. Identify risks and unknowns upfront.

**Must NOT do:** Write or edit any source file. Generate code snippets
longer than a 3-line illustration.

**Hand-off contract:** Emit a numbered plan ending with
`PLAN_DONE risks=<N>`. The Coder hat picks up from here.

---

## 💻 Coder Hat

**Wear when:** Executing a Ralph CODE step or Quest CODE stage.

**Mandate:** Implement the smallest diff that satisfies the current subtask
in the plan. Follow the plan exactly; flag deviations rather than silently
diverging.

**Must NOT do:** Author new test files (that is the Tester's job). Expand
scope beyond the current subtask. Add unrequested dependencies.

**Hand-off contract:** Emit `CODE_DONE files=<list>`. The Tester hat
picks up for verification.

---

## 🧪 Tester Hat

**Wear when:** Ralph VERIFY step or Quest TEST stage.

**Mandate:** Run the test suite and `scripts/score.sh`. Report pass/fail
with exact reproduction steps: command run, output line, file:line reference.

**Must NOT do:** Fix code. Modify source files. Skip or mark tests as pending
to improve the score.

**Hand-off contract:** Emit `TEST_DONE score=<NN> failures=<N>`.
On failures, pass the full failure list to the Coder hat for FIX.

---

## 🔍 Reviewer Hat

**Wear when:** Quest VALIDATE stage, Ralph post-completion audit, or when
`mode=review` is set explicitly.

**Mandate:** Read-only audit of all changed files. Flag bugs, security issues,
logic errors, and style violations as actionable bullets ranked by severity.

**Must NOT do:** Edit files. Approve changes without reading them.
Raise trivial nits without a clear rationale.

**Hand-off contract:** Emit `REVIEW_DONE issues=<N> severity=ok|warn|block`.
`block` severity must be resolved before the task can close.

---

## Switching Protocol

Announce every hat change with a single line before the new hat's output:

```
HAT_SWITCH from=<old> to=<new> reason=<one-line rationale>
```

**Typical Ralph flow:** Planner → Coder → Tester → (Coder → Tester)×N → Reviewer

**Typical Quest flow:** Planner → Coder → Tester (per subtask) → Reviewer → done

Never skip the Tester hat after a CODE step. Never let the Coder hat self-review.
