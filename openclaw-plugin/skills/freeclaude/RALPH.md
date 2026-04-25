---
name: freeclaude-ralph-loop
description: "PLAN → CODE → VERIFY → FIX → REPEAT loop with script-based scoring. Use when the task needs iterative refinement until tests pass."
trigger_modes: [ralph]
metadata:
  openclaw:
    emoji: "🔁"
    category: "coding-orchestration"
---

# Ralph Loop Protocol

## Purpose

Invoke Ralph when a task requires iterative correction: failing tests, complex
refactors, or any change where a single pass is unlikely to be correct. The loop
drives the agent toward a verifiable exit rather than a one-shot attempt.

**Use Ralph when:**

- CI is red and needs to turn green
- A refactor touches >3 files and regressions are likely
- A PR comment demands verifiable proof of correctness
- Any task where "run tests and fix" must repeat

Default maximum iterations: **5**. Override via `max_iterations` param.

---

## Protocol

1. **PLAN** — Decompose the task into ≤8 concise bullets. Name files to touch,
   describe the expected outcome, list known risks. No code yet.

2. **CODE** — Implement the smallest diff that satisfies the plan. Prefer
   targeted edits over rewrites. One logical change per file where possible.

3. **VERIFY** — Run `scripts/score.sh` (or equivalent). Expect JSON output:
   ```json
   { "tests": 40, "build": 20, "lint": 20, "regressions": 20, "total": 100 }
   ```
   Capture exact failure messages; do not discard them.

4. **DECIDE** — Evaluate exit criteria:
   - `score >= threshold` **AND** all tests pass → **DONE**
   - `score < threshold` OR any test fails → proceed to FIX
   - Max iterations reached → STOP with `status=max-iter`
   - Struggle detected → STOP with `status=struggle`

5. **FIX** — Read only the failure lines returned by VERIFY. Edit the minimum
   set of files that address those failures. Do not touch passing files.
   Return to step 3.

6. **STOP CONDITIONS** (any one triggers exit):
   - `score >= threshold` AND tests green
   - `iteration == max_iterations`
   - Struggle detected (see below)

---

## Scoring

| Dimension     | Weight | Pass condition                        |
|---------------|--------|---------------------------------------|
| Tests         | 40     | Zero failing test cases               |
| Build         | 20     | Exit code 0 from compiler/bundler     |
| Lint          | 20     | Zero new lint errors (vs base branch) |
| No regressions| 20     | No previously-passing tests now fail  |
| **Total**     | **100**|                                       |

Default threshold: **80**. Override via `score_threshold` param.

---

## Context Rotation

Between iterations, prune the assistant's scratch work to stay within context
limits. **Keep:** the PLAN from iteration 1, the last failure summary, and any
lessons extracted. **Drop:** intermediate assistant reasoning, superseded diffs.

Inject a condensed header at the top of each new iteration:

```
Ralph iteration N/max — Plan: <one-liner> — Last failure: <summary>
```

---

## Struggle Detection

If the same failure signature appears in **3 consecutive iterations**, declare
struggle. Actions (in order):

1. Switch tactic — try an alternative approach described in the PLAN risks.
2. Inject a hint — surface the most relevant lesson from lessons store.
3. Give up gracefully — emit `status=struggle` with a clear human-readable
   report: what was tried, what failed, what to try next manually.

Never spin a fourth attempt on an identical failure without changing approach.

---

## Output Contract

Every Ralph run ends with a single envelope line:

```
RALPH_DONE iter=<N> score=<NN> status=ok|struggle|max-iter
```

Followed by a brief summary: files changed, tests passing, any residual warnings.

---

## Anti-Patterns

- **Do not** rewrite a file that was already passing — it risks regressions.
- **Do not** add new dependencies solely to silence a lint warning.
- **Do not** mark a test as skipped or deleted to achieve a green score.
- **Do not** carry full iteration 1 context into iteration 5 — rotate aggressively.
- **Do not** exit with `status=ok` if any test is still failing.
