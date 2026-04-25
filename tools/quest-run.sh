#!/usr/bin/env bash
# quest-run.sh — Quest Mode orchestrator for FreeClaude
#
# Implements a staged pipeline: spec → PLAN → CODE → TEST → VALIDATE → REPORT
# Each stage is a focused freeclaude-run.sh call. State is persisted between
# stages so runs are resumable via --resume-quest.
#
# Usage:
#   tools/quest-run.sh --spec PATH/TO/SPEC.md [OPTIONS]
#
# Examples:
#   tools/quest-run.sh --spec docs/auth-spec.md
#   tools/quest-run.sh --spec docs/auth-spec.md --resume-quest
#   tools/quest-run.sh --spec docs/auth-spec.md --model claude-sonnet-4.5 --workdir ./src
#   tools/quest-run.sh --spec docs/api-spec.md --quest-id my-quest-001 --debug

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
SPEC=""
WORKDIR=""
MODEL=""
QUEST_ID=""     # derived from spec sha1[:8] if not provided
RESUME_QUEST=0  # --resume-quest loads existing state and continues
DEBUG=0

# Ordered stage list — processing order is fixed
ALL_STAGES=("PLAN" "CODE" "TEST" "VALIDATE" "REPORT")

# ---------------------------------------------------------------------------
# Usage / help
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
quest-run.sh — Staged Quest Mode: spec → PLAN → CODE → TEST → VALIDATE → REPORT

USAGE:
  tools/quest-run.sh --spec PATH [OPTIONS]

FLAGS:
  --spec PATH         (required) Path to markdown spec file
  --workdir DIR       Working directory for code operations (default: cwd)
  --model NAME        Model name passed to freeclaude-run.sh for each stage
  --quest-id ID       Override quest ID (default: sha1 of spec content, first 8 chars)
  --resume-quest      Load existing state and continue from last incomplete stage
  --debug             Enable bash -x tracing
  --help              Show this help and exit

STAGES:
  PLAN       Read spec, emit a numbered plan (≤12 items). No file edits.
  CODE       Execute each plan item in sequence via freeclaude-run.sh.
  TEST       Run scripts/score.sh; record score JSON.
  VALIDATE   Verify each acceptance criterion from spec against workdir state.
  REPORT     Emit summary to stdout; write final envelope.

STATE FILE:
  ~/.freeclaude/quests/<quest-id>.json  (read/written each stage)

OUTPUT (single JSON line on stdout):
  {
    "mode": "quest",
    "id": "...",
    "status": "ok|partial|blocked",
    "stages": ["PLAN","CODE","TEST","VALIDATE","REPORT"],
    "stagesDone": N,
    "score": {...},
    "unmetCriteria": [...],
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
    --spec)          SPEC="$2";       shift 2 ;;
    --workdir)       WORKDIR="$2";    shift 2 ;;
    --model)         MODEL="$2";      shift 2 ;;
    --quest-id)      QUEST_ID="$2";   shift 2 ;;
    --resume-quest)  RESUME_QUEST=1;  shift ;;
    --debug)         DEBUG=1;         shift ;;
    --help|-h)       usage ;;
    *) echo "quest-run.sh: unknown flag: $1" >&2; exit 1 ;;
  esac
done

[[ "$DEBUG" == "1" ]] && set -x

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
if [[ -z "$SPEC" ]]; then
  echo "quest-run.sh: --spec is required" >&2
  exit 1
fi
if [[ ! -f "$SPEC" ]]; then
  echo "quest-run.sh: spec file not found: $SPEC" >&2
  exit 1
fi
SPEC="$(cd "$(dirname "$SPEC")" && pwd)/$(basename "$SPEC")"

if [[ -z "$WORKDIR" ]]; then
  WORKDIR="$(pwd)"
else
  if [[ ! -d "$WORKDIR" ]]; then
    echo "quest-run.sh: workdir does not exist: $WORKDIR" >&2
    exit 1
  fi
  WORKDIR="$(cd "$WORKDIR" && pwd)"
fi

# ---------------------------------------------------------------------------
# Quest ID — sha1[:8] of spec content, or user-provided
# ---------------------------------------------------------------------------
if [[ -z "$QUEST_ID" ]]; then
  QUEST_ID="$(python3 -c "
import hashlib, sys
content = open(sys.argv[1], 'rb').read()
print(hashlib.sha1(content).hexdigest()[:8])
" "$SPEC" 2>/dev/null)" || QUEST_ID="quest$(date +%s)"
fi

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_DIR="$HOME/.freeclaude/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/fc-quest-$$.log"
echo "quest-run.sh: log file: $LOG_FILE" >&2

log() {
  local msg="[quest $QUEST_ID $$] $*"
  echo "$msg" >&2
  echo "$msg" >> "$LOG_FILE"
}

log "Starting Quest | spec=$SPEC id=$QUEST_ID workdir=$WORKDIR"

# ---------------------------------------------------------------------------
# State directory and file
# ---------------------------------------------------------------------------
QUEST_DIR="$HOME/.freeclaude/quests"
mkdir -p "$QUEST_DIR"
STATE_FILE="$QUEST_DIR/${QUEST_ID}.json"

# ---------------------------------------------------------------------------
# JSON helpers — stdin-piping pattern avoids shell quoting issues
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
# State management helpers
# ---------------------------------------------------------------------------

# Write/update the state file; fields provided as env vars via python3 heredoc
state_init() {
  QSTATE_ID="$QUEST_ID" \
  QSTATE_SPEC="$SPEC" \
  QSTATE_FILE="$STATE_FILE" \
  python3 - <<'PY'
import json, os, time
from pathlib import Path

sf = Path(os.environ["QSTATE_FILE"])
now = int(time.time() * 1000)
state = {
    "id": os.environ["QSTATE_ID"],
    "spec": os.environ["QSTATE_SPEC"],
    "createdAt": now,
    "updatedAt": now,
    "stage": "PLAN",
    "plan": [],
    "completedItems": [],
    "score": {},
    "validation": {},
    "history": [],
    "totalCostUsd": 0.0,
}
sf.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
PY
}

state_read() {
  python3 -c "
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
if p.exists():
    print(p.read_text(encoding='utf-8'), end='')
else:
    print('{}', end='')
" "$STATE_FILE" 2>/dev/null || echo "{}"
}

state_update() {
  # Called after each stage: updates stage, appends history entry, and merges extra fields
  # Args: stage_name envelope_json [extra_key extra_value_json ...]
  local stage="$1" envelope="$2"
  QSTATE_FILE="$STATE_FILE" \
  QSTATE_STAGE="$stage" \
  QSTATE_ENVELOPE="$envelope" \
  python3 - <<'PY'
import json, os, time
from pathlib import Path

sf = Path(os.environ["QSTATE_FILE"])
state = json.loads(sf.read_text(encoding="utf-8")) if sf.exists() else {}
now = int(time.time() * 1000)
state["updatedAt"] = now
state["stage"] = os.environ["QSTATE_STAGE"]

history = state.get("history", [])
try:
    envelope = json.loads(os.environ.get("QSTATE_ENVELOPE") or "{}")
except Exception:
    envelope = {}

history.append({
    "stage": os.environ["QSTATE_STAGE"],
    "envelope": envelope,
    "ts": now,
})
state["history"] = history

cost = float(envelope.get("costUsd") or 0)
state["totalCostUsd"] = round(float(state.get("totalCostUsd") or 0) + cost, 6)

sf.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
PY
}

state_set_field() {
  # Merge an arbitrary JSON field into the state file
  local key="$1" value_json="$2"
  QSTATE_FILE="$STATE_FILE" \
  QSTATE_KEY="$key" \
  QSTATE_VALUE="$value_json" \
  python3 - <<'PY'
import json, os
from pathlib import Path

sf = Path(os.environ["QSTATE_FILE"])
state = json.loads(sf.read_text(encoding="utf-8")) if sf.exists() else {}
try:
    state[os.environ["QSTATE_KEY"]] = json.loads(os.environ["QSTATE_VALUE"])
except Exception:
    state[os.environ["QSTATE_KEY"]] = os.environ["QSTATE_VALUE"]
sf.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
PY
}

# ---------------------------------------------------------------------------
# FC invocation helper — runs freeclaude-run.sh and returns envelope JSON
# ---------------------------------------------------------------------------
run_fc() {
  local prompt="$1"
  local envelope=""
  local fc_args=(--workdir "$WORKDIR" --output-format json)
  [[ -n "$MODEL" ]] && fc_args+=(--model "$MODEL")
  envelope="$(bash "$SCRIPT_DIR/freeclaude-run.sh" "${fc_args[@]}" -- "$prompt" 2>>"$LOG_FILE")" || true
  printf '%s' "$envelope"
}

# ---------------------------------------------------------------------------
# Stage: PLAN — read spec, produce numbered plan ≤12 items, no file edits
# ---------------------------------------------------------------------------
stage_plan() {
  log "Stage PLAN: generating plan from spec"
  local prompt="Read the spec at '${SPEC}' and emit a numbered plan with at most 12 items. Each item must be a single actionable step. Stop after emitting the plan; do NOT modify any files."
  local envelope
  envelope="$(run_fc "$prompt")"
  local plan_text
  plan_text="$(json_get "$envelope" "output" "")"
  log "Plan received (${#plan_text} chars)"

  # Parse numbered items from plan text into a JSON array
  local plan_json
  plan_json="$(PLAN_TEXT="$plan_text" python3 - <<'PY'
import json, os, re
text = os.environ.get("PLAN_TEXT", "")
items = []
for m in re.finditer(r'^\s*(\d+)[.)]\s+(.+)', text, re.MULTILINE):
    item = m.group(2).strip()
    if item:
        items.append(item)
print(json.dumps(items[:12], ensure_ascii=False))
PY
)"

  state_update "CODE" "$envelope"
  state_set_field "plan" "$plan_json"
  printf '%s' "$plan_json"
}

# ---------------------------------------------------------------------------
# Stage: CODE — execute each plan item via a dedicated FC run
# ---------------------------------------------------------------------------
stage_code() {
  local plan_json="$1"
  log "Stage CODE: executing plan items"

  local item_count
  item_count="$(printf '%s' "$plan_json" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")"
  log "Plan has $item_count items"

  local i=1
  local completed_json="[]"
  local last_envelope="{}"

  while IFS= read -r item; do
    [[ -z "$item" ]] && continue
    log "CODE item $i/$item_count: ${item:0:60}"
    local prompt="Per the spec at '${SPEC}', execute plan item ${i}: ${item}. Modify only files mentioned or implied by the spec."
    last_envelope="$(run_fc "$prompt")"
    completed_json="$(printf '%s' "$completed_json" | python3 -c "
import json, sys
lst = json.load(sys.stdin)
lst.append({'item': int('$i'), 'text': '''$item'''[:200]})
print(json.dumps(lst, ensure_ascii=False))
" 2>/dev/null || echo "$completed_json")"
    state_update "CODE" "$last_envelope"
    i=$(( i + 1 ))
  done < <(printf '%s' "$plan_json" | python3 -c "import json,sys
for item in json.load(sys.stdin):
    print(item)" 2>/dev/null)

  state_set_field "completedItems" "$completed_json"
  state_update "TEST" "$last_envelope"
}

# ---------------------------------------------------------------------------
# Stage: TEST — run scripts/score.sh in workdir; record score
# ---------------------------------------------------------------------------
stage_test() {
  log "Stage TEST: running scorer"
  local score_json=""
  score_json="$(cd "$WORKDIR" && bash "$SCRIPT_DIR/../scripts/score.sh" \
      --threshold 80 --project-type auto 2>>"$LOG_FILE")" || true
  log "Score result: $score_json"
  state_set_field "score" "${score_json:-{\}}"
  state_update "VALIDATE" "{}"
  printf '%s' "${score_json:-{}}"
}

# ---------------------------------------------------------------------------
# Stage: VALIDATE — verify acceptance criteria; no file edits
# ---------------------------------------------------------------------------
stage_validate() {
  log "Stage VALIDATE: verifying acceptance criteria"
  local prompt="Read the acceptance criteria in the spec at '${SPEC}'. For each criterion, verify whether it is met by the current state of the working directory '${WORKDIR}'. Do NOT modify any files. Output only a JSON object with keys 'met' (array of met criteria) and 'unmet' (array of unmet criteria)."
  local envelope
  envelope="$(run_fc "$prompt")"
  local output
  output="$(json_get "$envelope" "output" "{}")"

  # Parse the {met,unmet} JSON from the assistant's output
  local validation_json
  validation_json="$(VALIDATE_OUT="$output" python3 - <<'PY'
import json, os, re

raw = os.environ.get("VALIDATE_OUT", "")
# Try parsing the whole output as JSON first
try:
    parsed = json.loads(raw)
    if isinstance(parsed, dict) and ("met" in parsed or "unmet" in parsed):
        print(json.dumps(parsed, ensure_ascii=False))
        raise SystemExit(0)
except Exception:
    pass
# Fall back: find first JSON object in the text
m = re.search(r'\{[^{}]*"(?:met|unmet)"[^{}]*\}', raw, re.DOTALL)
if m:
    try:
        parsed = json.loads(m.group(0))
        print(json.dumps(parsed, ensure_ascii=False))
        raise SystemExit(0)
    except Exception:
        pass
print('{"met":[],"unmet":[]}')
PY
)"

  state_set_field "validation" "$validation_json"
  state_update "REPORT" "$envelope"
  printf '%s' "$validation_json"
}

# ---------------------------------------------------------------------------
# Stage: REPORT — emit summary; no FC call needed
# ---------------------------------------------------------------------------
stage_report() {
  log "Stage REPORT: building final report"
  state_update "DONE" "{}"
}

# ---------------------------------------------------------------------------
# Load or initialise state
# ---------------------------------------------------------------------------
if [[ "$RESUME_QUEST" == "1" && -f "$STATE_FILE" ]]; then
  log "Resuming from existing state: $STATE_FILE"
  CURRENT_STATE="$(state_read)"
  START_STAGE="$(json_get "$CURRENT_STATE" "stage" "PLAN")"
  log "Resuming from stage: $START_STAGE"
else
  log "Initialising new quest state"
  state_init
  START_STAGE="PLAN"
fi

# ---------------------------------------------------------------------------
# Execute stages from START_STAGE onward
# ---------------------------------------------------------------------------
STAGES_DONE=0
PLAN_JSON="[]"
SCORE_DATA="{}"
VALIDATION_DATA="{}"
QUEST_BLOCKED=0

# Determine which stages to run based on resume point
RUN_PLAN=0; RUN_CODE=0; RUN_TEST=0; RUN_VALIDATE=0; RUN_REPORT=0
case "$START_STAGE" in
  PLAN)     RUN_PLAN=1; RUN_CODE=1; RUN_TEST=1; RUN_VALIDATE=1; RUN_REPORT=1 ;;
  CODE)     RUN_CODE=1; RUN_TEST=1; RUN_VALIDATE=1; RUN_REPORT=1 ;;
  TEST)     RUN_TEST=1; RUN_VALIDATE=1; RUN_REPORT=1 ;;
  VALIDATE) RUN_VALIDATE=1; RUN_REPORT=1 ;;
  REPORT)   RUN_REPORT=1 ;;
  DONE)     log "Quest already done; nothing to run"; STAGES_DONE=5 ;;
esac

# If resuming, load persisted plan/score/validation from state
if [[ "$RESUME_QUEST" == "1" && -f "$STATE_FILE" ]]; then
  CURRENT_STATE="$(state_read)"
  PLAN_JSON="$(json_get_array "$CURRENT_STATE" "plan")"
  SCORE_DATA_RAW="$(json_get "$CURRENT_STATE" "score" "{}")"
  SCORE_DATA="${SCORE_DATA_RAW:-{}}"
  VALIDATION_DATA_RAW="$(json_get "$CURRENT_STATE" "validation" "{}")"
  VALIDATION_DATA="${VALIDATION_DATA_RAW:-{}}"
fi

if [[ "$RUN_PLAN" == "1" ]]; then
  PLAN_JSON="$(stage_plan)" || { log "PLAN stage failed"; QUEST_BLOCKED=1; }
  [[ "$QUEST_BLOCKED" == "0" ]] && STAGES_DONE=$(( STAGES_DONE + 1 ))
fi

if [[ "$QUEST_BLOCKED" == "0" && "$RUN_CODE" == "1" ]]; then
  stage_code "$PLAN_JSON" || { log "CODE stage failed"; QUEST_BLOCKED=1; }
  [[ "$QUEST_BLOCKED" == "0" ]] && STAGES_DONE=$(( STAGES_DONE + 1 ))
fi

if [[ "$QUEST_BLOCKED" == "0" && "$RUN_TEST" == "1" ]]; then
  SCORE_DATA="$(stage_test)" || { log "TEST stage failed"; QUEST_BLOCKED=1; }
  [[ "$QUEST_BLOCKED" == "0" ]] && STAGES_DONE=$(( STAGES_DONE + 1 ))
fi

if [[ "$QUEST_BLOCKED" == "0" && "$RUN_VALIDATE" == "1" ]]; then
  VALIDATION_DATA="$(stage_validate)" || { log "VALIDATE stage failed"; QUEST_BLOCKED=1; }
  [[ "$QUEST_BLOCKED" == "0" ]] && STAGES_DONE=$(( STAGES_DONE + 1 ))
fi

if [[ "$QUEST_BLOCKED" == "0" && "$RUN_REPORT" == "1" ]]; then
  stage_report
  STAGES_DONE=$(( STAGES_DONE + 1 ))
fi

# ---------------------------------------------------------------------------
# Determine final status
# ---------------------------------------------------------------------------
if [[ "$QUEST_BLOCKED" == "1" ]]; then
  QUEST_STATUS="blocked"
elif [[ "$STAGES_DONE" -eq "${#ALL_STAGES[@]}" ]]; then
  QUEST_STATUS="ok"
else
  QUEST_STATUS="partial"
fi

# Load final state for cost total and unmet criteria
FINAL_STATE="$(state_read)"
TOTAL_COST_USD="$(json_get "$FINAL_STATE" "totalCostUsd" "0")"
UNMET_CRITERIA="$(VDATA="$VALIDATION_DATA" python3 -c "
import json, os, sys
try:
    v = json.loads(os.environ.get('VDATA','{}'))
    print(json.dumps(v.get('unmet', []), separators=(',',':')))
except Exception:
    print('[]')
" 2>/dev/null || echo "[]")"

log "Quest complete: status=$QUEST_STATUS stagesDone=$STAGES_DONE totalCost=$TOTAL_COST_USD"

# ---------------------------------------------------------------------------
# Emit final envelope — single JSON line on stdout
# ---------------------------------------------------------------------------
QENV_STATUS="$QUEST_STATUS" \
QENV_ID="$QUEST_ID" \
QENV_STAGES_DONE="$STAGES_DONE" \
QENV_SCORE="$SCORE_DATA" \
QENV_UNMET="$UNMET_CRITERIA" \
QENV_TOTAL_COST="${TOTAL_COST_USD:-0}" \
python3 - <<'PY'
import json, os

envelope = {
    "mode": "quest",
    "id": os.environ["QENV_ID"],
    "status": os.environ["QENV_STATUS"],
    "stages": ["PLAN", "CODE", "TEST", "VALIDATE", "REPORT"],
    "stagesDone": int(os.environ.get("QENV_STAGES_DONE") or "0"),
    "score": json.loads(os.environ.get("QENV_SCORE") or "{}"),
    "unmetCriteria": json.loads(os.environ.get("QENV_UNMET") or "[]"),
    "totalCostUsd": float(os.environ.get("QENV_TOTAL_COST") or "0"),
}
print(json.dumps(envelope, ensure_ascii=False))
PY
