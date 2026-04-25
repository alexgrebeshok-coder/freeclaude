#!/usr/bin/env bash
# fc-fork.sh — Fork a FreeClaude session into a named branch and run a task
# on the forked checkpoint.
#
# Usage:
#   fc-fork.sh --session SID --task "..." [--from-turn N] [--name NAME]
#              [--workdir DIR] [--model X]
#
# Output (stdout, final line):
#   {"branchId":"...","fcSessionId":"...","envelope":{...}}
#
# Exit codes: 0 = success, 1 = error, 2 = bad args.

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
SESSION_ID=""
TASK_TEXT=""
FROM_TURN="0"
BRANCH_NAME=""
WORKDIR="${PWD}"
MODEL=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SESSION_TREE="${REPO_ROOT}/scripts/session-tree.ts"
FC_RUN="${SCRIPT_DIR}/freeclaude-run.sh"

# ---------------------------------------------------------------------------
# --help
# ---------------------------------------------------------------------------
print_help() {
  cat <<'EOF'
fc-fork.sh — Fork a FreeClaude session and run a task on the fork.

Usage:
  fc-fork.sh --session SID --task "TASK TEXT" [OPTIONS]

Options:
  --session    SID        (required) FreeClaude session ID to fork from
  --task       TEXT       (required) Task description to pass to freeclaude-run.sh
  --from-turn  N          Turn number to fork from (default: 0)
  --name       NAME       Human-readable name for the branch (e.g. feat/my-idea)
  --workdir    DIR        Working directory for the task (default: \$PWD)
  --model      MODEL      Model override passed to freeclaude-run.sh
  --help                  Show this help and exit 0
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
if [[ $# -eq 0 ]]; then
  print_help
  exit 0
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      print_help
      exit 0
      ;;
    --session)
      SESSION_ID="${2:-}"
      shift 2
      ;;
    --task)
      TASK_TEXT="${2:-}"
      shift 2
      ;;
    --from-turn)
      FROM_TURN="${2:-0}"
      shift 2
      ;;
    --name)
      BRANCH_NAME="${2:-}"
      shift 2
      ;;
    --workdir)
      WORKDIR="${2:-$PWD}"
      shift 2
      ;;
    --model)
      MODEL="${2:-}"
      shift 2
      ;;
    *)
      echo "fc-fork.sh: unknown option: $1" >&2
      exit 2
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
if [[ -z "$SESSION_ID" ]]; then
  echo "fc-fork.sh: --session SID is required" >&2
  exit 2
fi

if [[ -z "$TASK_TEXT" ]]; then
  echo "fc-fork.sh: --task TEXT is required" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Step 1: Create branch record via session-tree.ts
# ---------------------------------------------------------------------------
FORK_ARGS=(--session "$SESSION_ID" --from-turn "$FROM_TURN")
if [[ -n "$BRANCH_NAME" ]]; then
  FORK_ARGS+=(--name "$BRANCH_NAME")
fi

FORK_OUTPUT="$(bun run "$SESSION_TREE" fork "${FORK_ARGS[@]}")"
BRANCH_ID="$(echo "$FORK_OUTPUT" | grep '^BRANCH_ID=' | cut -d= -f2)"

if [[ -z "$BRANCH_ID" ]]; then
  echo "fc-fork.sh: failed to create branch record" >&2
  exit 1
fi

echo "fc-fork.sh: created branch ${BRANCH_ID}" >&2

# ---------------------------------------------------------------------------
# Step 2: Run freeclaude-run.sh capturing the JSON envelope
# ---------------------------------------------------------------------------
FC_ARGS=(
  --output-format json
  --fork-session
  --resume "$SESSION_ID"
  --workdir "$WORKDIR"
  "$TASK_TEXT"
)
if [[ -n "$MODEL" ]]; then
  FC_ARGS+=(--model "$MODEL")
fi

ENVELOPE="$("$FC_RUN" "${FC_ARGS[@]}")"

# ---------------------------------------------------------------------------
# Step 3: Resolve fcSessionId from envelope and annotate branch
# ---------------------------------------------------------------------------
FC_SESSION_ID="$(echo "$ENVELOPE" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d.get('sessionId','') or d.get('session_id',''))" \
  2>/dev/null || true)"

if [[ -n "$FC_SESSION_ID" ]]; then
  bun run "$SESSION_TREE" annotate \
    --branch "$BRANCH_ID" \
    --fc-session-id "$FC_SESSION_ID" >&2 || true
fi

# ---------------------------------------------------------------------------
# Step 4: Emit final JSON summary
# ---------------------------------------------------------------------------
python3 -c "
import sys, json
envelope = json.loads(sys.argv[1])
print(json.dumps({
  'branchId': sys.argv[2],
  'fcSessionId': sys.argv[3],
  'envelope': envelope,
}))
" "$ENVELOPE" "$BRANCH_ID" "${FC_SESSION_ID:-}"
