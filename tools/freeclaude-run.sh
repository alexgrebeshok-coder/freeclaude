#!/bin/bash
# FreeClaude wrapper for OpenClaw integration
# Usage:
#   freeclaude-run.sh [--model MODEL] [--workdir DIR] [--timeout SECS]
#                    [--resume SESSION_ID] [--fork-session]
#                    [--output-format text|json|stream-json] "prompt"
#
# Modes:
#   text        - human-friendly output (default)
#   json        - normalized single JSON envelope
#   stream-json - wrapper events + raw FreeClaude stream-json + final envelope

set -euo pipefail

MODEL=""
WORKDIR=""
TIMEOUT=120
OUTPUT_FORMAT="text"
PROMPT=""
USER_PROMPT=""
FC_BINARY="${FC_BINARY:-freeclaude}"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"
BRIDGE_SCRIPT="$OPENCLAW_ROOT/workspace/tools/fc-memory-bridge.sh"
FC_STATE_DIR="${FC_STATE_DIR:-$OPENCLAW_ROOT/workspace/.openclaw/extensions/freeclaude/state}"
FC_PERSIST_RUN_STATE="${FC_PERSIST_RUN_STATE:-1}"
MEMORY_BRIDGE_ENABLED=0
MEMORY_CONTEXT_INJECTED=0
RESUME_SESSION_ID=""
FORK_SESSION=0

emit_wrapper_event() {
  local event_name="$1"
  WRAPPER_EVENT_NAME="$event_name" \
  WRAPPER_WORKDIR="$WORKDIR" \
  WRAPPER_TIMEOUT="$TIMEOUT" \
  WRAPPER_OUTPUT_FORMAT="$OUTPUT_FORMAT" \
  WRAPPER_MODEL_HINT="$MODEL" \
  WRAPPER_MEMORY_ENABLED="$MEMORY_BRIDGE_ENABLED" \
  WRAPPER_MEMORY_INJECTED="$MEMORY_CONTEXT_INJECTED" \
  python3 - <<'PY'
import json
import os

payload = {
    "type": "wrapper_event",
    "event": os.environ["WRAPPER_EVENT_NAME"],
    "workdir": os.environ.get("WRAPPER_WORKDIR") or None,
    "timeoutSec": int(os.environ.get("WRAPPER_TIMEOUT") or "0"),
    "outputFormat": os.environ.get("WRAPPER_OUTPUT_FORMAT") or "text",
    "modelHint": os.environ.get("WRAPPER_MODEL_HINT") or None,
    "memoryBridgeEnabled": os.environ.get("WRAPPER_MEMORY_ENABLED") == "1",
    "memoryContextInjected": os.environ.get("WRAPPER_MEMORY_INJECTED") == "1",
}
print(json.dumps(payload, ensure_ascii=False), flush=True)
PY
}

build_result_envelope() {
  local status="$1"
  local stdout_file="$2"
  local stderr_file="$3"

  WRAPPER_STATUS="$status" \
  WRAPPER_WORKDIR="$WORKDIR" \
  WRAPPER_TIMEOUT="$TIMEOUT" \
  WRAPPER_MODEL_HINT="$MODEL" \
  WRAPPER_DURATION_MS="$DURATION_MS" \
  WRAPPER_PROVIDER_STATS="$COST_LINE" \
  WRAPPER_EXIT_CODE="$EXIT_CODE" \
  WRAPPER_MEMORY_ENABLED="$MEMORY_BRIDGE_ENABLED" \
  WRAPPER_MEMORY_INJECTED="$MEMORY_CONTEXT_INJECTED" \
  python3 - "$stdout_file" "$stderr_file" <<'PY'
import json
import os
import sys
from pathlib import Path

stdout_text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace").strip()
stderr_text = Path(sys.argv[2]).read_text(encoding="utf-8", errors="replace")

status = os.environ.get("WRAPPER_STATUS", "error")
exit_code = int(os.environ.get("WRAPPER_EXIT_CODE") or "0")
duration_ms = int(os.environ.get("WRAPPER_DURATION_MS") or "0")
timeout_sec = int(os.environ.get("WRAPPER_TIMEOUT") or "0")
workdir = os.environ.get("WRAPPER_WORKDIR") or None
model_hint = os.environ.get("WRAPPER_MODEL_HINT") or None
provider_stats = os.environ.get("WRAPPER_PROVIDER_STATS") or None
memory_bridge_enabled = os.environ.get("WRAPPER_MEMORY_ENABLED") == "1"
memory_context_injected = os.environ.get("WRAPPER_MEMORY_INJECTED") == "1"

filtered_errors = "\n".join(
    line for line in stderr_text.splitlines() if line.strip() and not line.startswith("[FreeClaude]")
).strip()

raw_result = None
output = stdout_text
session_id = None
cost_usd = None
usage = None
resolved_model = model_hint
stop_reason = None

if stdout_text:
    try:
        parsed = json.loads(stdout_text)
        if isinstance(parsed, dict):
            raw_result = parsed
            if parsed.get("type") == "result":
                output = str(parsed.get("result", "")).strip()
                session_id = parsed.get("session_id")
                cost_usd = parsed.get("total_cost_usd")
                usage = parsed.get("usage")
                stop_reason = parsed.get("stop_reason")
                model_usage = parsed.get("modelUsage")
                if not resolved_model and isinstance(model_usage, dict) and model_usage:
                    resolved_model = next(iter(model_usage.keys()))
    except Exception:
        for line in reversed(stdout_text.splitlines()):
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except Exception:
                continue
            if isinstance(parsed, dict) and parsed.get("type") == "result":
                raw_result = parsed
                output = str(parsed.get("result", "")).strip()
                session_id = parsed.get("session_id")
                cost_usd = parsed.get("total_cost_usd")
                usage = parsed.get("usage")
                stop_reason = parsed.get("stop_reason")
                model_usage = parsed.get("modelUsage")
                if not resolved_model and isinstance(model_usage, dict) and model_usage:
                    resolved_model = next(iter(model_usage.keys()))
                break

error_text = filtered_errors or None
if status != "success" and not error_text and output:
    error_text = output

summary_source = output if output else error_text or ""
summary = ""
for line in summary_source.splitlines():
    line = line.strip()
    if line:
        summary = line
        break

envelope = {
    "type": "wrapper_result",
    "status": status,
    "summary": summary,
    "output": output,
    "error": error_text,
    "workdir": workdir,
    "model": resolved_model,
    "durationMs": duration_ms,
    "timeoutSec": timeout_sec,
    "sessionId": session_id,
    "costUsd": cost_usd,
    "usage": usage,
    "stopReason": stop_reason,
    "providerStats": provider_stats,
    "memoryBridgeEnabled": memory_bridge_enabled,
    "memoryContextInjected": memory_context_injected,
    "filesTouched": [],
    "commandsRun": [],
    "exitCode": exit_code,
}

if raw_result is not None:
    envelope["rawResult"] = raw_result

print(json.dumps(envelope, ensure_ascii=False))
PY
}

record_memory_summary() {
  local envelope_json="$1"
  local lowered_prompt=""

  if [[ ! -x "$BRIDGE_SCRIPT" || "${FC_MEMORY_BRIDGE:-1}" == "0" || "${FC_RECORD_MEMORY:-1}" == "0" ]]; then
    return 0
  fi

  lowered_prompt="$(printf '%s' "$USER_PROMPT" | tr '[:upper:]' '[:lower:]')"
  if [[ "${FC_RECORD_MEMORY_FORCE:-0}" != "1" ]]; then
    case "$lowered_prompt" in
      reply\ with\ exactly:*|*probe*)
        return 0
        ;;
    esac
  fi

  SUMMARY_LINE="$(ENVELOPE_JSON="$envelope_json" USER_PROMPT="$USER_PROMPT" python3 - <<'PY'
import json
import os
import textwrap

data = json.loads(os.environ["ENVELOPE_JSON"])
summary = (data.get("summary") or "").strip()
status = (data.get("status") or "").strip()
task = textwrap.shorten((os.environ.get("USER_PROMPT") or "").strip(), width=140, placeholder="...")
model = (data.get("model") or "").strip()
session_id = (data.get("sessionId") or "").strip()
duration_ms = data.get("durationMs") or 0

if summary:
    print(f"Task: {task}")
    print(f"Status: {status}")
    print(f"Summary: {textwrap.shorten(summary, width=220, placeholder='...')}")
    if model:
        print(f"Model: {model}")
    if session_id:
        print(f"Session: {session_id}")
    if isinstance(duration_ms, (int, float)) and duration_ms > 0:
        print(f"Duration: {round(duration_ms / 1000, 1)}s")
PY
)"

  if [[ -n "${SUMMARY_LINE:-}" ]]; then
    "$BRIDGE_SCRIPT" record "$SUMMARY_LINE" "${WORKDIR:-cli}" >/dev/null 2>&1 || true
  fi
}

persist_runtime_state() {
  local envelope_json="$1"

  if [[ "${FC_PERSIST_RUN_STATE:-1}" == "0" ]]; then
    return 0
  fi

  FC_STATE_DIR="$FC_STATE_DIR" \
  ENVELOPE_JSON="$envelope_json" \
  USER_PROMPT="$USER_PROMPT" \
  WORKDIR="$WORKDIR" \
  MODEL="$MODEL" \
  python3 - <<'PY'
import json
import os
import time
import uuid
from pathlib import Path

state_dir = Path(os.environ["FC_STATE_DIR"]).expanduser()
state_dir.mkdir(parents=True, exist_ok=True)
envelope = json.loads(os.environ["ENVELOPE_JSON"])
now = int(time.time() * 1000)
run_entry = {
    "runId": str(uuid.uuid4()),
    "status": (envelope.get("status") or "unknown").strip(),
    "task": (os.environ.get("USER_PROMPT") or "").strip()[:4000],
    "mode": "code",
    "workdir": (os.environ.get("WORKDIR") or "").strip()[:4000],
    "model": (envelope.get("model") or os.environ.get("MODEL") or "").strip()[:200],
    "timeout": envelope.get("timeoutSec") or 120,
    "includeMemory": envelope.get("memoryBridgeEnabled") is True,
    "sessionKey": "",
    "resumeSessionId": "",
    "freeClaudeSessionId": (envelope.get("sessionId") or "").strip()[:200],
    "forkSession": False,
    "parentRunId": "",
    "summary": (envelope.get("summary") or "").strip()[:4000],
    "partialOutput": (envelope.get("output") or "").strip()[-4000:],
    "lastEvent": "wrapper_result",
    "startedAt": now,
    "updatedAt": now,
    "finishedAt": now,
    "error": ((envelope.get("error") or None) and str(envelope.get("error")).strip()[:4000]),
    "exitCode": envelope.get("exitCode"),
    "result": envelope,
}

runs_path = state_dir / "runs.json"
try:
    runs_payload = json.loads(runs_path.read_text(encoding="utf-8")) if runs_path.exists() else {}
except Exception:
    runs_payload = {}

runs = runs_payload.get("runs") if isinstance(runs_payload, dict) else []
if not isinstance(runs, list):
    runs = []
runs.append(run_entry)
runs.sort(key=lambda item: item.get("startedAt") or 0)
runs = runs[-50:]

tmp_runs = runs_path.with_suffix(".json.tmp")
tmp_runs.write_text(
    json.dumps({"version": 1, "updatedAt": now, "runs": runs}, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
tmp_runs.replace(runs_path)
PY
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL="$2"
      shift 2
      ;;
    --workdir)
      WORKDIR="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    --resume)
      RESUME_SESSION_ID="$2"
      shift 2
      ;;
    --fork-session)
      FORK_SESSION=1
      shift
      ;;
    --output-format)
      OUTPUT_FORMAT="$2"
      shift 2
      ;;
    --)
      shift
      PROMPT="$*"
      break
      ;;
    *)
      PROMPT="$*"
      break
      ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  echo "Error: No prompt provided"
  echo "Usage: freeclaude-run.sh [--model MODEL] [--workdir DIR] [--timeout SECS] [--resume SESSION_ID] [--fork-session] [--output-format text|json|stream-json] \"prompt\""
  exit 1
fi

case "$OUTPUT_FORMAT" in
  text|json|stream-json)
    ;;
  *)
    echo "Error: Unsupported output format: $OUTPUT_FORMAT"
    exit 1
    ;;
esac

USER_PROMPT="$PROMPT"

if [[ -n "$WORKDIR" ]]; then
  if [[ ! -d "$WORKDIR" ]]; then
    echo "Error: Workdir does not exist: $WORKDIR"
    exit 1
  fi
  WORKDIR="$(cd "$WORKDIR" && pwd)"
else
  WORKDIR="$(pwd)"
fi

OPENCLAW_ROOT="$(cd "$OPENCLAW_ROOT" && pwd)"

case "$WORKDIR/" in
  "$OPENCLAW_ROOT/"*)
    if [[ "${FC_ALLOW_OPENCLAW_WORKDIR:-0}" != "1" ]]; then
      echo "Error: Refusing to run FreeClaude inside $OPENCLAW_ROOT without FC_ALLOW_OPENCLAW_WORKDIR=1"
      exit 1
    fi
    ;;
esac

cd "$WORKDIR"

STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)
trap "rm -f '$STDOUT_FILE' '$STDERR_FILE'" EXIT

if [[ -x "$BRIDGE_SCRIPT" && "${FC_MEMORY_BRIDGE:-1}" != "0" ]]; then
  MEMORY_BRIDGE_ENABLED=1
  OC_CONTEXT=$("$BRIDGE_SCRIPT" inject "$WORKDIR" "$USER_PROMPT" 2>/dev/null || true)
  if [[ -n "$OC_CONTEXT" ]]; then
    MEMORY_CONTEXT_INJECTED=1
    PROMPT="$OC_CONTEXT

--- User Request ---
$USER_PROMPT"
  fi
fi

CMD_BASE=("$FC_BINARY" "--print" "--bare")
if [[ -n "$MODEL" ]]; then
  CMD_BASE+=("--model" "$MODEL")
fi
if [[ -n "$RESUME_SESSION_ID" ]]; then
  CMD_BASE+=("--resume" "$RESUME_SESSION_ID")
fi
if [[ "$FORK_SESSION" == "1" ]]; then
  CMD_BASE+=("--fork-session")
fi
CMD_BASE+=("--add-dir" "$WORKDIR" "--" "$PROMPT")

START_TIME=$(date +%s)
EXIT_CODE=0
DURATION_MS=0
COST_LINE=""

if [[ "$OUTPUT_FORMAT" == "stream-json" ]]; then
  emit_wrapper_event "init"
  STREAM_CMD=("$FC_BINARY" "--print" "--bare" "--verbose" "--output-format" "stream-json" "--include-partial-messages")
  if [[ -n "$MODEL" ]]; then
    STREAM_CMD+=("--model" "$MODEL")
  fi
  if [[ -n "$RESUME_SESSION_ID" ]]; then
    STREAM_CMD+=("--resume" "$RESUME_SESSION_ID")
  fi
  if [[ "$FORK_SESSION" == "1" ]]; then
    STREAM_CMD+=("--fork-session")
  fi
  STREAM_CMD+=("--add-dir" "$WORKDIR" "--" "$PROMPT")

  set +e
  perl -e "
    alarm $TIMEOUT;
    \$SIG{ALRM} = sub { kill 'TERM', \$pid; die 'timeout' };
    \$pid = fork;
    if (\$pid == 0) {
      exec @ARGV;
    }
    waitpid(\$pid, 0);
    exit(\$? >> 8);
  " "${STREAM_CMD[@]}" 2>"$STDERR_FILE" | tee "$STDOUT_FILE"
  EXIT_CODE=${PIPESTATUS[0]}
  set -e

  END_TIME=$(date +%s)
  DURATION_MS=$(((END_TIME - START_TIME) * 1000))
  COST_LINE=$(grep '^\[FreeClaude\].*tokens' "$STDERR_FILE" 2>/dev/null | tail -1 | sed 's/\[FreeClaude\] //' || true)
  STATUS="success"
  if [[ $EXIT_CODE -ne 0 ]]; then
    STATUS="error"
  fi

  ENVELOPE_JSON="$(build_result_envelope "$STATUS" "$STDOUT_FILE" "$STDERR_FILE")"
  persist_runtime_state "$ENVELOPE_JSON"
  printf '%s\n' "$ENVELOPE_JSON" || true

  if [[ "$STATUS" == "success" ]]; then
    record_memory_summary "$ENVELOPE_JSON"
    exit 0
  fi
  exit "$EXIT_CODE"
fi

if [[ "$OUTPUT_FORMAT" == "json" ]]; then
  JSON_CMD=("$FC_BINARY" "--print" "--bare" "--output-format" "json")
  if [[ -n "$MODEL" ]]; then
    JSON_CMD+=("--model" "$MODEL")
  fi
  if [[ -n "$RESUME_SESSION_ID" ]]; then
    JSON_CMD+=("--resume" "$RESUME_SESSION_ID")
  fi
  if [[ "$FORK_SESSION" == "1" ]]; then
    JSON_CMD+=("--fork-session")
  fi
  JSON_CMD+=("--add-dir" "$WORKDIR" "--" "$PROMPT")

  set +e
  perl -e "
    alarm $TIMEOUT;
    \$SIG{ALRM} = sub { kill 'TERM', \$pid; die 'timeout' };
    \$pid = fork;
    if (\$pid == 0) {
      exec @ARGV;
    }
    waitpid(\$pid, 0);
    exit(\$? >> 8);
  " "${JSON_CMD[@]}" >"$STDOUT_FILE" 2>"$STDERR_FILE"
  EXIT_CODE=$?
  set -e

  END_TIME=$(date +%s)
  DURATION_MS=$(((END_TIME - START_TIME) * 1000))
  COST_LINE=$(grep '^\[FreeClaude\].*tokens' "$STDERR_FILE" 2>/dev/null | tail -1 | sed 's/\[FreeClaude\] //' || true)
  STATUS="success"
  if [[ $EXIT_CODE -ne 0 ]]; then
    STATUS="error"
  fi

  ENVELOPE_JSON="$(build_result_envelope "$STATUS" "$STDOUT_FILE" "$STDERR_FILE")"
  persist_runtime_state "$ENVELOPE_JSON"
  printf '%s\n' "$ENVELOPE_JSON" || true

  if [[ "$STATUS" == "success" ]]; then
    record_memory_summary "$ENVELOPE_JSON"
    exit 0
  fi
  exit "$EXIT_CODE"
fi

set +e
perl -e "
  alarm $TIMEOUT;
  \$SIG{ALRM} = sub { kill 'TERM', \$pid; die 'timeout' };
  \$pid = fork;
  if (\$pid == 0) {
    exec @ARGV;
  }
  waitpid(\$pid, 0);
  exit(\$? >> 8);
" "${CMD_BASE[@]}" >"$STDOUT_FILE" 2>"$STDERR_FILE"
EXIT_CODE=$?
set -e

END_TIME=$(date +%s)
DURATION_MS=$(((END_TIME - START_TIME) * 1000))

STDOUT_CONTENT=$(cat "$STDOUT_FILE")
STDERR_CONTENT=$(grep -v '^\[FreeClaude\]' "$STDERR_FILE" 2>/dev/null || true)
COST_LINE=$(grep '^\[FreeClaude\].*tokens' "$STDERR_FILE" 2>/dev/null | tail -1 | sed 's/\[FreeClaude\] //' || true)

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "$STDOUT_CONTENT"
  if [[ -n "$COST_LINE" ]]; then
    echo ""
    echo "---"
    echo "⚡ FreeClaude | $((DURATION_MS / 1000))s | $COST_LINE"
  fi

  TEXT_ENVELOPE="$(build_result_envelope "success" "$STDOUT_FILE" "$STDERR_FILE")"
  persist_runtime_state "$TEXT_ENVELOPE"
  record_memory_summary "$TEXT_ENVELOPE"
else
  TEXT_ENVELOPE="$(build_result_envelope "error" "$STDOUT_FILE" "$STDERR_FILE")"
  persist_runtime_state "$TEXT_ENVELOPE"
  echo "❌ FreeClaude error (exit code $EXIT_CODE):"
  if [[ -n "$STDERR_CONTENT" ]]; then
    echo "$STDERR_CONTENT"
  fi
  if [[ -n "$STDOUT_CONTENT" ]]; then
    echo "Partial output:"
    echo "$STDOUT_CONTENT"
  fi
  exit "$EXIT_CODE"
fi
