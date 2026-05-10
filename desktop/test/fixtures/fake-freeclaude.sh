#!/usr/bin/env bash
# fake-freeclaude.sh — Canned stream-json responder for bridge unit tests.
#
# The bridge spawns: fake-freeclaude [-p] [--resume <id>] [--output-format stream-json] <prompt>
#
# Scenario dispatch is based on keywords embedded in the prompt argument:
#   SCENARIO:stderr      — stderr noise alongside normal output
#   SCENARIO:exit_no_result — exits cleanly (code 0) without emitting a result JSON line
#   SCENARIO:malformed   — emits one non-JSON line between valid assistant events
#   SCENARIO:long        — emits > 5 MB of assistant content to trigger buffer cap
#   (anything else)      — happy path: session_id + two chunks + result

set -euo pipefail

PROMPT=""
RESUME_ID=""

# Parse flags the bridge always passes.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --resume)
      RESUME_ID="${2:-}"
      shift 2
      ;;
    -p)
      shift
      ;;
    --output-format)
      shift 2   # skip the following 'stream-json' arg
      ;;
    *)
      # Everything remaining is the prompt.
      PROMPT="$*"
      break
      ;;
  esac
done

SESSION_ID="test-session-$$"

# Stdout is line-buffered by default in bash; use printf for each line.

case "$PROMPT" in
  *"SCENARIO:stderr"*)
    printf 'stderr warning line 1\n' >&2
    printf '{"session_id":"%s"}\n' "$SESSION_ID"
    printf '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}\n'
    printf 'stderr warning line 2\n' >&2
    printf '{"type":"result","subtype":"success","result":"done"}\n'
    ;;

  *"SCENARIO:exit_no_result"*)
    # Exits with code 0 but without a result JSON line.
    # The bridge must still emit a 'done' event via shouldComplete path.
    printf '{"session_id":"%s"}\n' "$SESSION_ID"
    printf '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}]}}\n'
    exit 0
    ;;

  *"SCENARIO:malformed"*)
    # One non-JSON line in the middle; bridge must skip it without crashing.
    printf '{"session_id":"%s"}\n' "$SESSION_ID"
    printf '{"type":"assistant","message":{"content":[{"type":"text","text":"before"}]}}\n'
    printf 'THIS IS NOT VALID JSON\n'
    printf '{"type":"assistant","message":{"content":[{"type":"text","text":"after"}]}}\n'
    printf '{"type":"result","subtype":"success","result":"done"}\n'
    ;;

  *"SCENARIO:long"*)
    # Generate > 5 MB of output to trigger the 5-MB buffer cap.
    # Each assistant line is ~74 bytes; 80 000 lines ≈ 5.9 MB.
    printf '{"session_id":"%s"}\n' "$SESSION_ID"
    awk 'BEGIN {
      line = "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"x\"}]}}"
      for (i = 0; i < 80000; i++) print line
    }'
    printf '{"type":"result","subtype":"success","result":"done"}\n'
    ;;

  *)
    # Happy path.
    printf '{"session_id":"%s"}\n' "$SESSION_ID"
    printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}\n'
    printf '{"type":"assistant","message":{"content":[{"type":"text","text":" World"}]}}\n'
    printf '{"type":"result","subtype":"success","result":"done"}\n'
    ;;
esac
