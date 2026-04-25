#!/usr/bin/env bash
# =============================================================================
# score.sh — Project health scorer for FreeClaude wrappers (Ralph/Quest)
# =============================================================================
#
# USAGE
#   scripts/score.sh [OPTIONS]
#
# DESCRIPTION
#   Runs tests, build, lint, and git-regression checks for a project, then
#   outputs a single JSON line with scores to STDOUT. All command output is
#   redirected to a log file (path printed to STDERR).
#
# OPTIONS
#   --project-type node|rust|python|go|auto
#       Override project-type detection. Default: auto (detect from cwd).
#
#   --threshold N
#       Exit code 0 if total >= N, 1 otherwise. Default: 80.
#
#   --quiet
#       Suppress all STDERR noise. JSON still emitted to STDOUT.
#
#   --help
#       Print this message and exit 0.
#
# OUTPUT (STDOUT — single JSON line)
#   {
#     "total": <0-100>,
#     "breakdown": { "tests":<0|20|40>, "build":<0|10|20>,
#                    "lint":<0|10|20>, "no_regressions":<0|10|20> },
#     "failedChecks": ["<category>", ...],
#     "raw": { "tests_cmd":"...", "tests_exit":<int>,
#              "build_cmd":"...", "build_exit":<int>,
#              "lint_cmd":"...",  "lint_exit":<int>,
#              "regressions_files":<int>, "regressions_lines":<int> }
#   }
#
# SCORING
#   tests          (max 40): pass=40  fail=0  no-cmd=20
#   build          (max 20): pass=20  fail=0  no-cmd=10
#   lint           (max 20): pass=20  fail=0  no-cmd=10
#   no_regressions (max 20): files<=30 && lines<=1000 → 20; else → 0; no-git → 10
#
# ENVIRONMENT
#   FC_SCORE_TIMEOUT   Override 300 s per-check timeout (seconds).
#
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Globals / defaults
# ---------------------------------------------------------------------------
PROJECT_TYPE="auto"
THRESHOLD=80
QUIET=0
LOG_FILE="/tmp/fc-score-$$.log"
TIMEOUT_SECS="${FC_SCORE_TIMEOUT:-300}"

SC_TESTS=0
SC_BUILD=0
SC_LINT=0
SC_REGRESSIONS=0

RAW_TESTS_CMD="(skipped)"
RAW_TESTS_EXIT=-1
RAW_BUILD_CMD="(skipped)"
RAW_BUILD_EXIT=-1
RAW_LINT_CMD="(skipped)"
RAW_LINT_EXIT=-1
RAW_REG_FILES=0
RAW_REG_LINES=0

FAILED_CHECKS=()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() {
  [[ $QUIET -eq 1 ]] && return 0
  echo "$*" >&2
}

die() {
  echo "score.sh: $*" >&2
  exit 2
}

# JSON-escape a string
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

# Detect a suitable timeout wrapper (graceful fallback on macOS)
TIMEOUT_CMD=""
if command -v timeout &>/dev/null; then
  TIMEOUT_CMD="timeout"
elif command -v gtimeout &>/dev/null; then
  TIMEOUT_CMD="gtimeout"
fi

# Run a command string, redirecting stdout+stderr to the log file.
# Returns the command's exit code.
run_check() {
  local cmd="$1"
  local rc=0
  if [[ -n "$TIMEOUT_CMD" ]]; then
    eval "$TIMEOUT_CMD $TIMEOUT_SECS $cmd" >>"$LOG_FILE" 2>&1 || rc=$?
  else
    eval "$cmd" >>"$LOG_FILE" 2>&1 || rc=$?
  fi
  return $rc
}

# Return true if a command exists on PATH
has_cmd() { command -v "$1" &>/dev/null; }

# Return true if package.json has the given npm script name
has_npm_script() {
  local script="$1"
  [[ -f "package.json" ]] || return 1
  if has_cmd node; then
    node -e "process.exit(JSON.parse(require('fs').readFileSync('package.json','utf8')).scripts?.['$script'] ? 0 : 1)" 2>/dev/null
  else
    grep -q "\"$script\"" package.json 2>/dev/null
  fi
}

# ---------------------------------------------------------------------------
# Flag parsing
# ---------------------------------------------------------------------------
usage() {
  # BSD sed (macOS) doesn't support address+compound commands the same way;
  # use awk which is universally available and portable.
  awk '
    /^# ===.*$/ && found { exit }
    found { sub(/^# ?/, ""); print }
    /^# USAGE/ { found=1 }
  ' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-type)
      [[ $# -lt 2 ]] && die "--project-type requires a value"
      PROJECT_TYPE="$2"; shift 2 ;;
    --threshold)
      [[ $# -lt 2 ]] && die "--threshold requires a value"
      THRESHOLD="$2"; shift 2 ;;
    --quiet)
      QUIET=1; shift ;;
    --help|-h)
      usage ;;
    *)
      die "Unknown option: $1. Use --help for usage." ;;
  esac
done

# ---------------------------------------------------------------------------
# Project-type detection
# ---------------------------------------------------------------------------
detect_project_type() {
  if   [[ -f "package.json" ]];              then echo "node"
  elif [[ -f "Cargo.toml" ]];                then echo "rust"
  elif [[ -f "pyproject.toml" || -f "setup.py" ]]; then echo "python"
  elif [[ -f "go.mod" ]];                    then echo "go"
  else echo "node"   # safe default
  fi
}

if [[ "$PROJECT_TYPE" == "auto" ]]; then
  PROJECT_TYPE="$(detect_project_type)"
fi

case "$PROJECT_TYPE" in
  node|rust|python|go) ;;
  *) die "Invalid project type: $PROJECT_TYPE (must be node|rust|python|go|auto)" ;;
esac

# ---------------------------------------------------------------------------
# Init log
# ---------------------------------------------------------------------------
: >"$LOG_FILE"
log "score.sh — log: $LOG_FILE  |  type: $PROJECT_TYPE  |  threshold: $THRESHOLD"
log "──────────────────────────────────────────────────────"

# ---------------------------------------------------------------------------
# 1. TESTS (max 40)
# ---------------------------------------------------------------------------
log "[1/4] tests…"

do_tests() {
  local cmd="" rc=0
  case "$PROJECT_TYPE" in
    node)
      if has_cmd bun && [[ -f "bun.lockb" || -f "bun.lock" ]]; then
        cmd="bun test"
      elif has_cmd npm && has_npm_script test; then
        cmd="npm test --silent"
      fi ;;
    rust)
      has_cmd cargo && cmd="cargo test --quiet" ;;
    python)
      has_cmd pytest && cmd="pytest -q" ;;
    go)
      has_cmd go && cmd="go test ./..." ;;
  esac

  if [[ -z "$cmd" ]]; then
    RAW_TESTS_CMD="(no command found)"
    RAW_TESTS_EXIT=-1
    SC_TESTS=20
    log "  ~ tests: no test command found (+20 neutral)"
    return 0
  fi

  RAW_TESTS_CMD="$cmd"
  run_check "$cmd" && rc=0 || rc=$?
  RAW_TESTS_EXIT=$rc

  if [[ $rc -eq 0 ]]; then
    SC_TESTS=40
    log "  ✓ tests passed (+40)"
  else
    SC_TESTS=0
    FAILED_CHECKS+=("tests")
    log "  ✗ tests failed (exit $rc, +0)"
  fi
}
do_tests

# ---------------------------------------------------------------------------
# 2. BUILD (max 20)
# ---------------------------------------------------------------------------
log "[2/4] build…"

do_build() {
  local cmd="" rc=0
  case "$PROJECT_TYPE" in
    node)
      if has_npm_script build; then
        cmd="npm run -s build"
      elif has_cmd tsc; then
        cmd="tsc --noEmit"
      fi ;;
    rust)
      has_cmd cargo && cmd="cargo build --quiet" ;;
    python)
      has_cmd python3 && cmd="python3 -m compileall -q ." ;;
    go)
      has_cmd go && cmd="go build ./..." ;;
  esac

  if [[ -z "$cmd" ]]; then
    RAW_BUILD_CMD="(no command found)"
    RAW_BUILD_EXIT=-1
    SC_BUILD=10
    log "  ~ build: no build command found (+10 neutral)"
    return 0
  fi

  RAW_BUILD_CMD="$cmd"
  run_check "$cmd" && rc=0 || rc=$?
  RAW_BUILD_EXIT=$rc

  if [[ $rc -eq 0 ]]; then
    SC_BUILD=20
    log "  ✓ build passed (+20)"
  else
    SC_BUILD=0
    FAILED_CHECKS+=("build")
    log "  ✗ build failed (exit $rc, +0)"
  fi
}
do_build

# ---------------------------------------------------------------------------
# 3. LINT (max 20)
# ---------------------------------------------------------------------------
log "[3/4] lint…"

do_lint() {
  local cmd="" rc=0
  case "$PROJECT_TYPE" in
    node)
      if has_npm_script lint; then
        cmd="npm run -s lint"
      elif has_cmd npx && ls eslint.config.* .eslintrc* .eslintrc.{js,cjs,yaml,yml,json} 2>/dev/null | grep -q .; then
        cmd="npx eslint . --max-warnings=0"
      fi ;;
    rust)
      has_cmd cargo && cmd="cargo clippy -q -- -D warnings" ;;
    python)
      if has_cmd ruff;   then cmd="ruff check ."
      elif has_cmd flake8; then cmd="flake8"
      fi ;;
    go)
      has_cmd go && cmd="go vet ./..." ;;
  esac

  if [[ -z "$cmd" ]]; then
    RAW_LINT_CMD="(no command found)"
    RAW_LINT_EXIT=-1
    SC_LINT=10
    log "  ~ lint: no lint command found (+10 neutral)"
    return 0
  fi

  RAW_LINT_CMD="$cmd"
  run_check "$cmd" && rc=0 || rc=$?
  RAW_LINT_EXIT=$rc

  if [[ $rc -eq 0 ]]; then
    SC_LINT=20
    log "  ✓ lint passed (+20)"
  else
    SC_LINT=0
    FAILED_CHECKS+=("lint")
    log "  ✗ lint failed (exit $rc, +0)"
  fi
}
do_lint

# ---------------------------------------------------------------------------
# 4. NO-REGRESSIONS (max 20)
# ---------------------------------------------------------------------------
log "[4/4] regressions…"

do_regressions() {
  if ! git rev-parse HEAD &>/dev/null 2>&1; then
    SC_REGRESSIONS=10
    RAW_REG_FILES=0
    RAW_REG_LINES=0
    log "  ~ regressions: not a git repo (+10 neutral)"
    return 0
  fi

  local numstat_out=""
  numstat_out=$(git diff --numstat HEAD 2>/dev/null || true)

  local files=0 lines=0
  if [[ -n "$numstat_out" ]]; then
    files=$(echo "$numstat_out" | grep -vc '^$' || true)
    lines=$(echo "$numstat_out" | awk '{
      # skip binary files (denoted by - -)
      if ($1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/) sum += $1 + $2
    } END { print sum+0 }')
  fi

  RAW_REG_FILES=$files
  RAW_REG_LINES=$lines

  if [[ $files -gt 30 || $lines -gt 1000 ]]; then
    SC_REGRESSIONS=0
    FAILED_CHECKS+=("no_regressions")
    log "  ✗ regressions: $files files / $lines lines changed — likely bloat (+0)"
  else
    SC_REGRESSIONS=20
    log "  ✓ regressions: $files files / $lines lines changed (+20)"
  fi
}
do_regressions

# ---------------------------------------------------------------------------
# Build JSON output
# ---------------------------------------------------------------------------
TOTAL=$(( SC_TESTS + SC_BUILD + SC_LINT + SC_REGRESSIONS ))

failed_json="["
sep=""
for check in "${FAILED_CHECKS[@]+"${FAILED_CHECKS[@]}"}"; do
  failed_json+="${sep}\"$(json_escape "$check")\""
  sep=","
done
failed_json+="]"

json_out="{\"total\":${TOTAL},\"breakdown\":{\"tests\":${SC_TESTS},\"build\":${SC_BUILD},\"lint\":${SC_LINT},\"no_regressions\":${SC_REGRESSIONS}},\"failedChecks\":${failed_json},\"raw\":{\"tests_cmd\":\"$(json_escape "$RAW_TESTS_CMD")\",\"tests_exit\":${RAW_TESTS_EXIT},\"build_cmd\":\"$(json_escape "$RAW_BUILD_CMD")\",\"build_exit\":${RAW_BUILD_EXIT},\"lint_cmd\":\"$(json_escape "$RAW_LINT_CMD")\",\"lint_exit\":${RAW_LINT_EXIT},\"regressions_files\":${RAW_REG_FILES},\"regressions_lines\":${RAW_REG_LINES}}}"

log "──────────────────────────────────────────────────────"
log "Total: ${TOTAL}/100  (threshold: ${THRESHOLD})"

# Output JSON to STDOUT only
echo "$json_out"

# Exit code based on threshold
if [[ $TOTAL -ge $THRESHOLD ]]; then
  exit 0
else
  exit 1
fi
