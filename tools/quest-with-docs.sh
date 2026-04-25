#!/usr/bin/env bash
# quest-with-docs.sh — Quest Mode with automatic TSDoc/JSDoc context injection
#
# Runs scripts/extract-doc.ts to extract doc comments from the target workdir,
# prepends the resulting Markdown to the spec file, then invokes quest-run.sh.
#
# Because quest-run.sh does not currently accept a separate system-prompt file,
# this wrapper concatenates the doc context directly to a temporary copy of the
# spec.  The original spec is never modified.  Temp files are cleaned up on exit.
#
# Usage:
#   tools/quest-with-docs.sh --spec PATH [OPTIONS]
#
# Examples:
#   tools/quest-with-docs.sh --spec docs/auth-spec.md
#   tools/quest-with-docs.sh --spec docs/auth-spec.md --workdir ./src --include "src/**"
#   tools/quest-with-docs.sh --spec docs/auth-spec.md --symbols "AuthService,AuthService.login"
#   tools/quest-with-docs.sh --spec docs/auth-spec.md --max-doc-files 50
#
# LIMITATION:
#   quest-run.sh does not accept a --append-system-prompt flag, so doc context
#   is prepended to a temporary copy of the spec file passed as --spec.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
SPEC=""
WORKDIR="${REPO_ROOT}"
INCLUDE="src/**"
SYMBOLS=""
MAX_DOC_FILES=500
EXTRA_ARGS=()   # forwarded verbatim to quest-run.sh

# Temp files cleaned up on exit
TMPSPEC=""
TMPDOC=""

cleanup() {
  [[ -n "${TMPSPEC}" && -f "${TMPSPEC}" ]] && rm -f "${TMPSPEC}"
  [[ -n "${TMPDOC}" && -f "${TMPDOC}" ]] && rm -f "${TMPDOC}"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Usage / help
# ---------------------------------------------------------------------------
usage() {
  cat <<'EOF'
quest-with-docs.sh — Quest Mode with TSDoc/JSDoc context injection

USAGE:
  tools/quest-with-docs.sh --spec PATH [OPTIONS] [-- quest-run-args...]

OPTIONS:
  --spec PATH           (required) Path to the Quest spec Markdown file
  --workdir DIR         Root dir for doc extraction and quest execution
                        (default: repo root)
  --include "glob,..."  Glob patterns passed to extract-doc --include
                        (default: "src/**")
  --symbols "a,B.m"     Symbol filter passed to extract-doc --symbols
  --max-doc-files N     Max files for doc extraction (default: 500)
  --help, -h            Show this help and exit

All unrecognised flags (or flags after --) are forwarded to quest-run.sh.

LIMITATION:
  quest-run.sh does not support a --append-system-prompt flag.  Doc context
  is therefore prepended to a temp copy of the spec file; the original is
  never modified.
EOF
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --spec)         SPEC="$2";          shift 2 ;;
    --workdir)      WORKDIR="$2";       shift 2 ;;
    --include)      INCLUDE="$2";       shift 2 ;;
    --symbols)      SYMBOLS="$2";       shift 2 ;;
    --max-doc-files) MAX_DOC_FILES="$2"; shift 2 ;;
    --help|-h)      usage; exit 0 ;;
    --)             shift; EXTRA_ARGS+=("$@"); break ;;
    *)              EXTRA_ARGS+=("$1"); shift ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate required args
# ---------------------------------------------------------------------------
if [[ -z "${SPEC}" ]]; then
  echo "quest-with-docs.sh: --spec is required" >&2
  usage >&2
  exit 1
fi

if [[ ! -f "${SPEC}" ]]; then
  echo "quest-with-docs.sh: spec file not found: ${SPEC}" >&2
  exit 1
fi

SPEC="$(cd "$(dirname "${SPEC}")" && pwd)/$(basename "${SPEC}")"

if [[ ! -d "${WORKDIR}" ]]; then
  echo "quest-with-docs.sh: workdir not found: ${WORKDIR}" >&2
  exit 1
fi

WORKDIR="$(cd "${WORKDIR}" && pwd)"

# Check bun is available
if ! command -v bun &>/dev/null; then
  echo "quest-with-docs.sh: 'bun' not found in PATH; cannot extract docs" >&2
  exit 1
fi

EXTRACT_SCRIPT="${REPO_ROOT}/scripts/extract-doc.ts"
if [[ ! -f "${EXTRACT_SCRIPT}" ]]; then
  echo "quest-with-docs.sh: extractor not found: ${EXTRACT_SCRIPT}" >&2
  exit 1
fi

QUEST_RUN="${REPO_ROOT}/tools/quest-run.sh"
if [[ ! -f "${QUEST_RUN}" ]]; then
  echo "quest-with-docs.sh: quest-run.sh not found: ${QUEST_RUN}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 1: extract doc context
# ---------------------------------------------------------------------------
TMPDOC="${WORKDIR}/fc-quest-doc-$$.md"

EXTRACT_ARGS=(
  "--workdir" "${WORKDIR}"
  "--format"    "md"
  "--max-files" "${MAX_DOC_FILES}"
)

if [[ -n "${INCLUDE}" ]]; then
  EXTRACT_ARGS+=("--include" "${INCLUDE}")
fi

if [[ -n "${SYMBOLS}" ]]; then
  EXTRACT_ARGS+=("--symbols" "${SYMBOLS}")
fi

echo "[quest-with-docs] Extracting doc context from ${WORKDIR} ..." >&2
bun run "${EXTRACT_SCRIPT}" "${EXTRACT_ARGS[@]}" --out "${TMPDOC}" >&2

if [[ ! -f "${TMPDOC}" ]]; then
  echo "[quest-with-docs] WARNING: doc extraction produced no output; proceeding without doc context" >&2
  TMPDOC=""
fi

# ---------------------------------------------------------------------------
# Step 2: build enriched spec
# ---------------------------------------------------------------------------
TMPSPEC="${WORKDIR}/fc-quest-spec-$$.md"

{
  if [[ -n "${TMPDOC}" ]]; then
    echo "<!-- doc-context: auto-generated by quest-with-docs.sh; do not edit -->"
    cat "${TMPDOC}"
    echo ""
    echo "---"
    echo ""
  fi
  cat "${SPEC}"
} > "${TMPSPEC}"

echo "[quest-with-docs] Combined spec written to ${TMPSPEC}" >&2

# ---------------------------------------------------------------------------
# Step 3: invoke quest-run.sh with the enriched spec
# ---------------------------------------------------------------------------
echo "[quest-with-docs] Launching quest-run.sh ..." >&2

exec bash "${QUEST_RUN}" \
  --spec  "${TMPSPEC}" \
  --workdir "${WORKDIR}" \
  "${EXTRA_ARGS[@]}"
