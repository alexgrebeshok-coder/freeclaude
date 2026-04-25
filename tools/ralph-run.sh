#!/usr/bin/env bash
# ralph-run.sh — Ralph Loop orchestrator for FreeClaude
#
# Wraps freeclaude-run.sh + scripts/score.sh in a scored retry loop.
# Each iteration: run FC → score → check threshold → retry with context.
#
# Usage:
#   tools/ralph-run.sh --task "..." [OPTIONS]
#
# Examples:
#   tools/ralph-run.sh --task "Fix the failing tests" --max-iterations 3
#   tools/ralph-run.sh --task "Implement auth module" --score-threshold 90 --model claude-sonnet-4.5
#   tools/ralph-run.sh --task "Refactor DB layer" --budget-usd 0.50 --lessons
#   tools/ralph-run.sh --task "Add pagination" --no-struggle-detection --workdir ./api

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# JSON tool detection — prefer jq (faster), fall back to python3
# ---------------------------------------------------------------------------
if command -v jq &>/dev/null; then
  JSON_TOOL="jq"
else
  JSON_TOOL="py"
fi

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
TASK=""
WORKDIR=""
MAX_ITERATIONS=5
SCORE_THRESHOLD=80
MODEL=""
STRUGGLE_DETECTION=1   # --no-struggle-detection disables
CONTEXT_ROTATION=1     # --no-context-rotation disables
LESSONS=0              # --lessons enables
BUDGET_USD=""          # unset = no budget cap
DEBUG=0

# ---------------------------------------------------------------------------
# Usage / help
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
ralph-run.sh — Iterative Ralph Loop: run → score → retry until threshold met.

USAGE:
  tools/ralph-run.sh --task "PROMPT" [OPTIONS]

FLAGS:
  --task TEXT                 (required) Initial prompt / task description
  --workdir DIR               Working directory (default: current directory)
  --max-iterations N          Max loop iterations before giving up (default: 5)
  --score-threshold N         Minimum score to consider success (default: 80)
  --model NAME                Model name passed to freeclaude-run.sh each iter
  --enable-struggle-detection Enable 3-consecutive-same-failure stop (default: on)
  --no-struggle-detection     Disable struggle detection
  --enable-context-rotation   Rebuild prompt with failure context each iter (default: on)
  --no-context-rotation       Disable context rotation
  --lessons                   Prepend up to 5 lessons from ~/.freeclaude/lessons.json
  --budget-usd N              Stop if cumulative costUsd exceeds N
  --debug                     Enable bash -x tracing
  --help                      Show this help and exit

OUTPUT (single JSON line on stdout):
  {
    "mode": "ralph",
    "status": "ok|struggle|max-iter|budget-exceeded|fatal",
    "iterations": N,
    "bestIter": N,
    "bestScore": N,
    "finalScore": N,
    "totalCostUsd": F,
    "history": [{"iter": N, "score": N, "costUsd": F, "failedChecks": [...]}]
  }

STOP CONDITIONS (checked in order each iteration):
  ok              score.total >= threshold (score.sh exits 0)
  struggle        last 3 iters had identical non-empty failedChecks
  max-iter        reached --max-iterations without passing threshold
  budget-exceeded cumulative costUsd exceeded --budget-usd
  fatal           freeclaude-run.sh returned non-zero exitCode with error status
EOF
  exit 0
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --task)                     TASK="$2";            shift 2 ;;
    --workdir)                  WORKDIR="$2";         shift 2 ;;
    --max-iterations)           MAX_ITERATIONS="$2";  shift 2 ;;
    --score-threshold)          SCORE_THRESHOLD="$2"; shift 2 ;;
    --model)                    MODEL="$2";           shift 2 ;;
    --enable-struggle-detection) STRUGGLE_DETECTION=1; shift ;;
    --no-struggle-detection)    STRUGGLE_DETECTION=0; shift ;;
    --enable-context-rotation)  CONTEXT_ROTATION=1;   shift ;;
    --no-context-rotation)      CONTEXT_ROTATION=0;   shift ;;
    --lessons)                  LESSONS=1;            shift ;;
    --budget-usd)               BUDGET_USD="$2";      shift 2 ;;
    --debug)                    DEBUG=1;              shift ;;
    --help|-h)                  usage ;;
    *) echo "ralph-run.sh: unknown flag: $1" >&2; exit 1 ;;
  esac
done

[[ "$DEBUG" == "1" ]] && set -x

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
if [[ -z "$TASK" ]]; then
  echo "ralph-run.sh: --task is required" >&2
  exit 1
fi

if [[ -z "$WORKDIR" ]]; then
  WORKDIR="$(pwd)"
else
  if [[ ! -d "$WORKDIR" ]]; then
    echo "ralph-run.sh: workdir does not exist: $WORKDIR" >&2
    exit 1
  fi
  WORKDIR="$(cd "$WORKDIR" && pwd)"
fi

# ---------------------------------------------------------------------------
# Logging — diagnostics to stderr; also write to log file under ~/.freeclaude
# ---------------------------------------------------------------------------
LOG_DIR="$HOME/.freeclaude/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/fc-ralph-$$.log"
echo "ralph-run.sh: log file: $LOG_FILE" >&2

log() {
  local msg="[ralph $$] $*"
  echo "$msg" >&2
  echo "$msg" >> "$LOG_FILE"
}

log "Starting Ralph Loop | task=${TASK:0:80}..."
log "workdir=$WORKDIR maxIter=$MAX_ITERATIONS threshold=$SCORE_THRESHOLD"

# ---------------------------------------------------------------------------
# JSON helpers — stdin-based to avoid shell quoting hazards
# ---------------------------------------------------------------------------

# json_get KEY [DEFAULT] < JSON  — extract scalar field
json_get() {
  local json="$1" key="$2" default="${3:-}"
  if [[ "$JSON_TOOL" == "jq" ]]; then
    local v
    v="$(printf '%s' "$json" | jq -r ".${key} // empty" 2>/dev/null)" || true
    printf '%s' "${v:-$default}"
  else
    printf '%s' "$json" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    v = d.get(sys.argv[1])
    if v is not None and not isinstance(v, (list, dict)):
        sys.stdout.write(str(v))
    else:
        sys.stdout.write(sys.argv[2] if len(sys.argv) > 2 else '')
except Exception:
    sys.stdout.write(sys.argv[2] if len(sys.argv) > 2 else '')
" "$key" "$default" 2>/dev/null || printf '%s' "$default"
  fi
}

# json_get_array KEY < JSON  — extract array as compact JSON string
json_get_array() {
  local json="$1" key="$2"
  if [[ "$JSON_TOOL" == "jq" ]]; then
    printf '%s' "$json" | jq -c ".${key} // []" 2>/dev/null || echo "[]"
  else
    printf '%s' "$json" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    v = d.get(sys.argv[1], [])
    print(json.dumps(v if isinstance(v, list) else [], separators=(',', ':')), end='')
except Exception:
    print('[]', end='')
" "$key" 2>/dev/null || echo "[]"
  fi
}

# ---------------------------------------------------------------------------
# Lessons loader — prepend up to 5 relevant lessons if --lessons enabled
# ---------------------------------------------------------------------------
load_lessons() {
  local task="$1"
  if [[ "$LESSONS" != "1" ]]; then return; fi

  local lessons_file="$HOME/.freeclaude/lessons.json"
  if [[ ! -f "$lessons_file" ]]; then return; fi

  # Call scripts/lessons.ts via ts-node if available; silently skip on failure
  local lessons_script="$SCRIPT_DIR/../scripts/lessons.ts"
  if command -v npx &>/dev/null && [[ -f "$lessons_script" ]]; then
    npx --yes ts-node "$lessons_script" query --task "$task" --limit 5 2>/dev/null || true
  fi
}

# ---------------------------------------------------------------------------
# State tracking
# ---------------------------------------------------------------------------
ITER=0
BEST_SCORE=0
BEST_ITER=0
TOTAL_COST="0"
FINAL_SCORE=0
LOOP_STATUS="max-iter"

# History accumulated as JSON file
HISTORY_FILE="$HOME/.freeclaude/ralph-$$-history.json"
echo "[]" > "$HISTORY_FILE"

# Ring buffer for struggle detection — last 3 failedChecks (as compact JSON strings)
PREV_CHECKS_1=""
PREV_CHECKS_2=""
PREV_CHECKS_3=""

# ---------------------------------------------------------------------------
# Main Ralph Loop
# ---------------------------------------------------------------------------
while [[ $ITER -lt $MAX_ITERATIONS ]]; do
  ITER=$(( ITER + 1 ))
  log "--- Iteration $ITER/$MAX_ITERATIONS ---"

  # ---- Build prompt for this iteration ----------------------------------------
  PROMPT="$TASK"

  # Context rotation (iter ≥ 2): augment prompt with failure summary from last iter
  if [[ "$CONTEXT_ROTATION" == "1" && "$ITER" -ge 2 && -n "$PREV_CHECKS_1" && "$PREV_CHECKS_1" != "[]" ]]; then
    PROMPT="${TASK}

## Previous attempt failed. Failing checks to address:
${PREV_CHECKS_1}

Please fix all failing checks listed above."
  fi

  # Optionally prepend lessons relevant to this task
  LESSON_TEXT="$(load_lessons "$TASK")"
  if [[ -n "$LESSON_TEXT" ]]; then
    PROMPT="## Relevant lessons from past runs:
${LESSON_TEXT}

${PROMPT}"
  fi

  # ---- Invoke FreeClaude -------------------------------------------------------
  FC_ARGS=(--workdir "$WORKDIR" --output-format json)
  [[ -n "$MODEL" ]] && FC_ARGS+=(--model "$MODEL")

  ENVELOPE=""
  FC_EXIT=0
  ENVELOPE="$(bash "$SCRIPT_DIR/freeclaude-run.sh" "${FC_ARGS[@]}" -- "$PROMPT" 2>>"$LOG_FILE")" \
    || FC_EXIT=$?

  ENV_STATUS="$(json_get "$ENVELOPE" "status" "error")"
  ENV_EXIT="$(json_get "$ENVELOPE" "exitCode" "0")"
  ENV_COST="$(json_get "$ENVELOPE" "costUsd" "0")"
  [[ -z "$ENV_COST" || "$ENV_COST" == "null" ]] && ENV_COST="0"

  log "FC: status=$ENV_STATUS exitCode=$ENV_EXIT costUsd=$ENV_COST"

  # Accumulate total cost across iterations
  TOTAL_COST="$(python3 -c "print(round(float('${TOTAL_COST}') + float('${ENV_COST}'), 6))" 2>/dev/null || echo "$TOTAL_COST")"

  # Fatal: non-success exit with error status — no recovery signal present
  if [[ "$ENV_EXIT" != "0" && "$ENV_STATUS" == "error" ]]; then
    log "Fatal: freeclaude exitCode=$ENV_EXIT status=error — stopping loop"
    LOOP_STATUS="fatal"
    FINAL_SCORE=0
    break
  fi

  # ---- Run scorer -------------------------------------------------------------
  # score.sh: exits 0 if total>=threshold, emits JSON {total,breakdown,failedChecks,...}
  SCORE_JSON=""
  SCORE_EXIT=0
  SCORE_JSON="$(cd "$WORKDIR" && bash "$SCRIPT_DIR/../scripts/score.sh" \
      --threshold "$SCORE_THRESHOLD" --project-type auto 2>>"$LOG_FILE")" \
    || SCORE_EXIT=$?

  SCORE_TOTAL="$(json_get "$SCORE_JSON" "total" "0")"
  [[ -z "$SCORE_TOTAL" || "$SCORE_TOTAL" == "null" ]] && SCORE_TOTAL="0"
  FAILED_CHECKS="$(json_get_array "$SCORE_JSON" "failedChecks")"

  log "Score: $SCORE_TOTAL (threshold=$SCORE_THRESHOLD) failedChecks=$FAILED_CHECKS"
  FINAL_SCORE="$SCORE_TOTAL"

  # Update best score
  if python3 -c "import sys; sys.exit(0 if float('${SCORE_TOTAL}') > float('${BEST_SCORE}') else 1)" 2>/dev/null; then
    BEST_SCORE="$SCORE_TOTAL"
    BEST_ITER="$ITER"
  fi

  # Append iteration record to history file
  ITER_N="$ITER" ITER_SCORE="$SCORE_TOTAL" ITER_COST="$ENV_COST" \
  ITER_FAILED="$FAILED_CHECKS" ITER_HF="$HISTORY_FILE" \
  python3 - <<'PY'
import json, os
from pathlib import Path
hf = Path(os.environ["ITER_HF"])
history = json.loads(hf.read_text(encoding="utf-8")) if hf.exists() else []
history.append({
    "iter": int(os.environ["ITER_N"]),
    "score": float(os.environ.get("ITER_SCORE") or "0"),
    "costUsd": float(os.environ.get("ITER_COST") or "0"),
    "failedChecks": json.loads(os.environ.get("ITER_FAILED") or "[]"),
})
hf.write_text(json.dumps(history, ensure_ascii=False), encoding="utf-8")
PY

  # ---- Rotate struggle detection ring buffer ----------------------------------
  PREV_CHECKS_3="$PREV_CHECKS_2"
  PREV_CHECKS_2="$PREV_CHECKS_1"
  PREV_CHECKS_1="$FAILED_CHECKS"

  # ---- Check stop conditions (in spec-defined order) --------------------------

  # 1. Score threshold met → success
  if [[ "$SCORE_EXIT" == "0" ]]; then
    log "Score threshold met at iter $ITER (score=$SCORE_TOTAL) → ok"
    LOOP_STATUS="ok"
    break
  fi

  # 2. Struggle detection: 3 consecutive identical non-empty failedChecks
  if [[ "$STRUGGLE_DETECTION" == "1" && $ITER -ge 3 && \
        "$PREV_CHECKS_1" != "[]" && \
        "$PREV_CHECKS_1" == "$PREV_CHECKS_2" && \
        "$PREV_CHECKS_2" == "$PREV_CHECKS_3" ]]; then
    log "Struggle detected: same failedChecks for 3 consecutive iters → struggle"
    LOOP_STATUS="struggle"
    break
  fi

  # 3. Budget cap check
  if [[ -n "$BUDGET_USD" ]]; then
    if python3 -c "import sys; sys.exit(0 if float('${TOTAL_COST}') > float('${BUDGET_USD}') else 1)" 2>/dev/null; then
      log "Budget exceeded: totalCost=$TOTAL_COST > budget=$BUDGET_USD → budget-exceeded"
      LOOP_STATUS="budget-exceeded"
      break
    fi
  fi

  # 4. Reaching max iterations is handled by the while-condition on next cycle
done

# ---------------------------------------------------------------------------
# Emit final envelope — single JSON line on stdout
# ---------------------------------------------------------------------------
RALPH_STATUS="$LOOP_STATUS" \
RALPH_ITER="$ITER" \
RALPH_BEST_ITER="${BEST_ITER:-0}" \
RALPH_BEST_SCORE="${BEST_SCORE:-0}" \
RALPH_FINAL_SCORE="${FINAL_SCORE:-0}" \
RALPH_TOTAL_COST="$TOTAL_COST" \
RALPH_HISTORY_FILE="$HISTORY_FILE" \
python3 - <<'PY'
import json, os
from pathlib import Path

hf = Path(os.environ["RALPH_HISTORY_FILE"])
history = json.loads(hf.read_text(encoding="utf-8")) if hf.exists() else []

envelope = {
    "mode": "ralph",
    "status": os.environ["RALPH_STATUS"],
    "iterations": int(os.environ["RALPH_ITER"]),
    "bestIter": int(os.environ.get("RALPH_BEST_ITER") or "0"),
    "bestScore": float(os.environ.get("RALPH_BEST_SCORE") or "0"),
    "finalScore": float(os.environ.get("RALPH_FINAL_SCORE") or "0"),
    "totalCostUsd": float(os.environ.get("RALPH_TOTAL_COST") or "0"),
    "history": history,
}
print(json.dumps(envelope, ensure_ascii=False))
PY

log "Ralph Loop complete: status=$LOOP_STATUS iterations=$ITER bestScore=$BEST_SCORE totalCost=$TOTAL_COST"
