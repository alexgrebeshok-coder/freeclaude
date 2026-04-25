#!/usr/bin/env bash
# plan-act-run.sh — Two-stage Plan/Act orchestrator for FreeClaude
#
# Stage 1 (PLAN): a planning model generates a numbered execution plan.
# Stage 2 (ACT):  an acting model receives the original task + the plan
#                 and executes it by modifying files.
#
# Using different models for each stage lets you pair a capable reasoning
# model (planning) with a fast/cheap coding model (acting).
#
# Usage:
#   tools/plan-act-run.sh --task "..." --plan-model MODEL --act-model MODEL [OPTIONS]
#
# Examples:
#   tools/plan-act-run.sh \
#       --task "Add rate limiting to the API" \
#       --plan-model claude-sonnet-4.5 \
#       --act-model claude-haiku
#
#   tools/plan-act-run.sh \
#       --task "Migrate DB schema to v2" \
#       --plan-model claude-sonnet-4.5 \
#       --act-model moonshotai/kimi-k2.5 \
#       --workdir ./backend \
#       --debug
#
#   tools/plan-act-run.sh \
#       --task "Write unit tests for auth module" \
#       --plan-model claude-sonnet-4.5 \
#       --act-model claude-haiku \
#       --plan-system "You are a senior engineer. Output a numbered test plan only." \
#       --act-system "Implement the test plan. Commit after each test file."

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# JSON tool detection — prefer jq, fall back to python3
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
PLAN_MODEL=""
ACT_MODEL=""
PLAN_SYSTEM="You are a planning model. Output a numbered plan only. Do not edit files."
ACT_SYSTEM="Execute the provided plan. Make minimal commits."
DEBUG=0

# ---------------------------------------------------------------------------
# Usage / help
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
plan-act-run.sh — Two-stage Plan/Act: planning model generates plan, acting model executes it.

USAGE:
  tools/plan-act-run.sh --task "PROMPT" --plan-model MODEL --act-model MODEL [OPTIONS]

FLAGS:
  --task TEXT             (required) Task description / prompt
  --plan-model NAME       (required) Model used for PLAN stage (e.g. claude-sonnet-4.5)
  --act-model NAME        (required) Model used for ACT stage (e.g. claude-haiku)
  --workdir DIR           Working directory for both stages (default: cwd)
  --plan-system TEXT      System prompt override for planning stage
                          (default: "You are a planning model. Output a numbered plan only. Do not edit files.")
  --act-system TEXT       System prompt override for acting stage
                          (default: "Execute the provided plan. Make minimal commits.")
  --debug                 Enable bash -x tracing
  --help                  Show this help and exit

STAGES:
  PLAN  freeclaude-run.sh is called with --plan-model and --plan-system.
        The plan text is extracted from the envelope's 'output' field.
  ACT   freeclaude-run.sh is called with --act-model and --act-system.
        The composed prompt is: original task + "\n\nPLAN:\n" + plan text + execution directive.

OUTPUT (single JSON line on stdout):
  {
    "mode": "plan-act",
    "planModel": "...",
    "actModel": "...",
    "planText": "...",
    "planEnvelope": {...},
    "actEnvelope": {...},
    "totalCostUsd": F
  }
EOF
  exit 0
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --task)          TASK="$2";         shift 2 ;;
    --workdir)       WORKDIR="$2";      shift 2 ;;
    --plan-model)    PLAN_MODEL="$2";   shift 2 ;;
    --act-model)     ACT_MODEL="$2";    shift 2 ;;
    --plan-system)   PLAN_SYSTEM="$2";  shift 2 ;;
    --act-system)    ACT_SYSTEM="$2";   shift 2 ;;
    --debug)         DEBUG=1;           shift ;;
    --help|-h)       usage ;;
    *) echo "plan-act-run.sh: unknown flag: $1" >&2; exit 1 ;;
  esac
done

[[ "$DEBUG" == "1" ]] && set -x

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
if [[ -z "$TASK" ]]; then
  echo "plan-act-run.sh: --task is required" >&2
  exit 1
fi
if [[ -z "$PLAN_MODEL" ]]; then
  echo "plan-act-run.sh: --plan-model is required" >&2
  exit 1
fi
if [[ -z "$ACT_MODEL" ]]; then
  echo "plan-act-run.sh: --act-model is required" >&2
  exit 1
fi

if [[ -z "$WORKDIR" ]]; then
  WORKDIR="$(pwd)"
else
  if [[ ! -d "$WORKDIR" ]]; then
    echo "plan-act-run.sh: workdir does not exist: $WORKDIR" >&2
    exit 1
  fi
  WORKDIR="$(cd "$WORKDIR" && pwd)"
fi

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_DIR="$HOME/.freeclaude/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/fc-plan-act-$$.log"
echo "plan-act-run.sh: log file: $LOG_FILE" >&2

log() {
  local msg="[plan-act $$] $*"
  echo "$msg" >&2
  echo "$msg" >> "$LOG_FILE"
}

log "Starting Plan/Act | planModel=$PLAN_MODEL actModel=$ACT_MODEL"
log "task=${TASK:0:80} workdir=$WORKDIR"

# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# Stage 1: PLAN — planning model generates a numbered execution plan
# ---------------------------------------------------------------------------
log "Stage PLAN: invoking $PLAN_MODEL"

PLAN_ENVELOPE=""
PLAN_EXIT=0
PLAN_ENVELOPE="$(bash "$SCRIPT_DIR/freeclaude-run.sh" \
    --workdir "$WORKDIR" \
    --model "$PLAN_MODEL" \
    --append-system-prompt "$PLAN_SYSTEM" \
    --output-format json \
    -- "$TASK" 2>>"$LOG_FILE")" || PLAN_EXIT=$?

PLAN_STATUS="$(json_get "$PLAN_ENVELOPE" "status" "error")"
PLAN_COST="$(json_get "$PLAN_ENVELOPE" "costUsd" "0")"
[[ -z "$PLAN_COST" || "$PLAN_COST" == "null" ]] && PLAN_COST="0"

log "PLAN stage: status=$PLAN_STATUS costUsd=$PLAN_COST exit=$PLAN_EXIT"

# Extract the plan text from the envelope's 'output' field
PLAN_TEXT="$(json_get "$PLAN_ENVELOPE" "output" "")"

if [[ -z "$PLAN_TEXT" ]]; then
  log "Warning: PLAN stage returned empty output; acting on task alone"
  PLAN_TEXT="(No plan generated — execute the task directly.)"
fi

log "Plan text (${#PLAN_TEXT} chars): ${PLAN_TEXT:0:120}..."

# ---------------------------------------------------------------------------
# Stage 2: ACT — compose prompt = task + plan, then invoke acting model
# ---------------------------------------------------------------------------
# Build the composed prompt that the act model receives.
# Structure: original task → plan context → execution directive.
COMPOSED_PROMPT="${TASK}

PLAN:
${PLAN_TEXT}

Execute the plan now."

log "Stage ACT: invoking $ACT_MODEL (composed prompt ${#COMPOSED_PROMPT} chars)"

ACT_ENVELOPE=""
ACT_EXIT=0
ACT_ENVELOPE="$(bash "$SCRIPT_DIR/freeclaude-run.sh" \
    --workdir "$WORKDIR" \
    --model "$ACT_MODEL" \
    --append-system-prompt "$ACT_SYSTEM" \
    --output-format json \
    -- "$COMPOSED_PROMPT" 2>>"$LOG_FILE")" || ACT_EXIT=$?

ACT_STATUS="$(json_get "$ACT_ENVELOPE" "status" "error")"
ACT_COST="$(json_get "$ACT_ENVELOPE" "costUsd" "0")"
[[ -z "$ACT_COST" || "$ACT_COST" == "null" ]] && ACT_COST="0"

log "ACT stage: status=$ACT_STATUS costUsd=$ACT_COST exit=$ACT_EXIT"

# ---------------------------------------------------------------------------
# Compute total cost
# ---------------------------------------------------------------------------
TOTAL_COST="$(python3 -c "
print(round(float('${PLAN_COST}') + float('${ACT_COST}'), 6))
" 2>/dev/null || echo "0")"

log "Plan/Act complete | totalCostUsd=$TOTAL_COST planStatus=$PLAN_STATUS actStatus=$ACT_STATUS"

# ---------------------------------------------------------------------------
# Emit final envelope — single JSON line on stdout
# ---------------------------------------------------------------------------
PA_PLAN_MODEL="$PLAN_MODEL" \
PA_ACT_MODEL="$ACT_MODEL" \
PA_PLAN_TEXT="$PLAN_TEXT" \
PA_PLAN_ENVELOPE="$PLAN_ENVELOPE" \
PA_ACT_ENVELOPE="$ACT_ENVELOPE" \
PA_TOTAL_COST="$TOTAL_COST" \
python3 - <<'PY'
import json, os

def safe_json(raw):
    """Parse a JSON string; return the parsed object or the raw string on failure."""
    try:
        return json.loads(raw)
    except Exception:
        return raw or {}

envelope = {
    "mode": "plan-act",
    "planModel": os.environ["PA_PLAN_MODEL"],
    "actModel": os.environ["PA_ACT_MODEL"],
    "planText": os.environ.get("PA_PLAN_TEXT", ""),
    "planEnvelope": safe_json(os.environ.get("PA_PLAN_ENVELOPE") or "{}"),
    "actEnvelope": safe_json(os.environ.get("PA_ACT_ENVELOPE") or "{}"),
    "totalCostUsd": float(os.environ.get("PA_TOTAL_COST") or "0"),
}
print(json.dumps(envelope, ensure_ascii=False))
PY
