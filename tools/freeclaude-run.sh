#!/bin/bash
# FreeClaude wrapper for OpenClaw integration
# Usage:
#   freeclaude-run.sh [--model MODEL] [--workdir DIR] [--timeout SECS]
#                    [--resume SESSION_ID] [--fork-session]
#                    [--permission-mode MODE] [--bare|--no-bare] [--no-memory]
#                    [--output-format text|json|stream-json] "prompt"
#
# Modes:
#   text        - human-friendly output (default)
#   json        - normalized single JSON envelope
#   stream-json - wrapper events + raw FreeClaude stream-json + final envelope

set -euo pipefail

# Default model: Kimi K2.5 — #6 world coding (BenchLM Apr 2026)
# Override via --model flag, FC_MODEL env, or change below
MODEL="${FC_MODEL:-moonshotai/kimi-k2.5}"
WORKDIR=""
TIMEOUT=120
OUTPUT_FORMAT="text"
PROMPT=""
USER_PROMPT=""
MAX_TURNS=""
EFFORT="${FC_EFFORT:-medium}"
MAX_BUDGET_USD=""
# Default model chain (RF-accessible, ranked by coding score):
#   1. moonshotai/kimi-k2.5      — #6 world coding, $0.001/req
#   2. qwen/qwen3-coder-plus     — $0.001/req, fast
#   3. qwen/qwen3-coder-next     — $0.0002/req, cheapest
#   4. nvidia/nemotron-3-super-120b-a12b:free — free
# Set via --model, FC_MODEL env, or auto-selected from chain
FALLBACK_MODEL="${FC_FALLBACK_MODEL:-qwen/qwen3-coder-plus}"
ALLOWED_TOOLS=""
DISALLOWED_TOOLS=""
TOOLS_OVERRIDE=""
SYSTEM_PROMPT=""
APPEND_SYSTEM_PROMPT=""
JSON_SCHEMA=""
NO_SESSION_PERSISTENCE=0
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"
if [[ -n "${FC_BINARY:-}" ]]; then
  FC_BINARY="$FC_BINARY"
elif [[ -x "$OPENCLAW_ROOT/workspace/freeclaude/bin/freeclaude" ]]; then
  FC_BINARY="$OPENCLAW_ROOT/workspace/freeclaude/bin/freeclaude"
else
  FC_BINARY="freeclaude"
fi
BRIDGE_SCRIPT="$OPENCLAW_ROOT/workspace/tools/fc-memory-bridge.sh"
FC_STATE_DIR="${FC_STATE_DIR:-$OPENCLAW_ROOT/workspace/.openclaw/extensions/freeclaude/state}"
FC_PERSIST_RUN_STATE="${FC_PERSIST_RUN_STATE:-1}"
MEMORY_BRIDGE_ENABLED=0
MEMORY_CONTEXT_INJECTED=0
RESUME_SESSION_ID=""
FORK_SESSION=0
PERMISSION_MODE="${PERMISSION_MODE:-bypassPermissions}"
USE_BARE="${FC_BARE_MODE:-0}"
PREFER_ENV_OPENROUTER="${FC_PREFER_ENV_OPENROUTER:-auto}"
ADDITIONAL_DIRS=()

emit_wrapper_event() {
  local event_name="$1"
  WRAPPER_EVENT_NAME="$event_name" \
  WRAPPER_WORKDIR="$WORKDIR" \
  WRAPPER_TIMEOUT="$TIMEOUT" \
  WRAPPER_OUTPUT_FORMAT="$OUTPUT_FORMAT" \
  WRAPPER_MODEL_HINT="$MODEL" \
  WRAPPER_MEMORY_ENABLED="$MEMORY_BRIDGE_ENABLED" \
  WRAPPER_MEMORY_INJECTED="$MEMORY_CONTEXT_INJECTED" \
  WRAPPER_PERMISSION_MODE="$PERMISSION_MODE" \
  WRAPPER_BARE_MODE="$USE_BARE" \
  WRAPPER_MAX_TURNS="$MAX_TURNS" \
  WRAPPER_EFFORT="$EFFORT" \
  WRAPPER_MAX_BUDGET_USD="$MAX_BUDGET_USD" \
  WRAPPER_FALLBACK_MODEL="$FALLBACK_MODEL" \
  WRAPPER_ALLOWED_TOOLS="$ALLOWED_TOOLS" \
  WRAPPER_DISALLOWED_TOOLS="$DISALLOWED_TOOLS" \
  WRAPPER_TOOLS_OVERRIDE="$TOOLS_OVERRIDE" \
  WRAPPER_SYSTEM_PROMPT="$SYSTEM_PROMPT" \
  WRAPPER_APPEND_SYSTEM_PROMPT="$APPEND_SYSTEM_PROMPT" \
  WRAPPER_JSON_SCHEMA="$JSON_SCHEMA" \
  WRAPPER_NO_SESSION_PERSISTENCE="$NO_SESSION_PERSISTENCE" \
  python3 - <<'PY'
import json
import os

def split_tools(raw):
    if not raw:
        return []
    return [part for part in raw.replace(",", " ").split() if part]

def preview_text(raw, limit=240):
    if not raw:
        return None
    text = raw.strip()
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 3] + "..."

payload = {
    "type": "wrapper_event",
    "event": os.environ["WRAPPER_EVENT_NAME"],
    "workdir": os.environ.get("WRAPPER_WORKDIR") or None,
    "timeoutSec": int(os.environ.get("WRAPPER_TIMEOUT") or "0"),
    "outputFormat": os.environ.get("WRAPPER_OUTPUT_FORMAT") or "text",
    "modelHint": os.environ.get("WRAPPER_MODEL_HINT") or None,
    "memoryBridgeEnabled": os.environ.get("WRAPPER_MEMORY_ENABLED") == "1",
    "memoryContextInjected": os.environ.get("WRAPPER_MEMORY_INJECTED") == "1",
    "permissionMode": os.environ.get("WRAPPER_PERMISSION_MODE") or "bypassPermissions",
    "bareMode": os.environ.get("WRAPPER_BARE_MODE", "1") != "0",
    "maxTurns": int(os.environ["WRAPPER_MAX_TURNS"]) if os.environ.get("WRAPPER_MAX_TURNS") else None,
    "effort": os.environ.get("WRAPPER_EFFORT") or None,
    "maxBudgetUsd": float(os.environ["WRAPPER_MAX_BUDGET_USD"]) if os.environ.get("WRAPPER_MAX_BUDGET_USD") else None,
    "fallbackModel": os.environ.get("WRAPPER_FALLBACK_MODEL") or None,
    "allowedTools": split_tools(os.environ.get("WRAPPER_ALLOWED_TOOLS") or ""),
    "disallowedTools": split_tools(os.environ.get("WRAPPER_DISALLOWED_TOOLS") or ""),
    "tools": split_tools(os.environ.get("WRAPPER_TOOLS_OVERRIDE") or ""),
    "systemPrompt": preview_text(os.environ.get("WRAPPER_SYSTEM_PROMPT") or ""),
    "appendSystemPrompt": preview_text(os.environ.get("WRAPPER_APPEND_SYSTEM_PROMPT") or ""),
    "hasCustomPrompt": bool((os.environ.get("WRAPPER_SYSTEM_PROMPT") or "").strip() or (os.environ.get("WRAPPER_APPEND_SYSTEM_PROMPT") or "").strip()),
    "jsonSchema": preview_text(os.environ.get("WRAPPER_JSON_SCHEMA") or "", 400),
    "noSessionPersistence": os.environ.get("WRAPPER_NO_SESSION_PERSISTENCE") == "1",
}
print(json.dumps(payload, ensure_ascii=False), flush=True)
PY
}

build_result_envelope() {
  local status="$1"
  local stdout_file="$2"
  local stderr_file="$3"
  local head_before="$4"

  # Compute filesTouched via git diff
  local files_touched_json="[]"
  if [[ -n "$head_before" ]] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    files_touched_json=$(
      {
        git diff --name-only "$head_before"..HEAD 2>/dev/null
        git ls-files --others --exclude-standard 2>/dev/null
      } | sort -u | python3 -c '
import json, sys
files = [l.strip() for l in sys.stdin if l.strip()]
print(json.dumps(files))
' 2>/dev/null || echo "[]"
    )
  fi

  WRAPPER_STATUS="$status" \
  WRAPPER_WORKDIR="$WORKDIR" \
  WRAPPER_TIMEOUT="$TIMEOUT" \
  WRAPPER_MODEL_HINT="$MODEL" \
  WRAPPER_DURATION_MS="$DURATION_MS" \
  WRAPPER_PROVIDER_STATS="$COST_LINE" \
  WRAPPER_EXIT_CODE="$EXIT_CODE" \
  WRAPPER_MEMORY_ENABLED="$MEMORY_BRIDGE_ENABLED" \
  WRAPPER_MEMORY_INJECTED="$MEMORY_CONTEXT_INJECTED" \
  WRAPPER_PERMISSION_MODE="$PERMISSION_MODE" \
  WRAPPER_BARE_MODE="$USE_BARE" \
  WRAPPER_FILES_TOUCHED="$files_touched_json" \
  WRAPPER_MAX_TURNS="$MAX_TURNS" \
  WRAPPER_EFFORT="$EFFORT" \
  WRAPPER_MAX_BUDGET_USD="$MAX_BUDGET_USD" \
  WRAPPER_FALLBACK_MODEL="$FALLBACK_MODEL" \
  WRAPPER_ALLOWED_TOOLS="$ALLOWED_TOOLS" \
  WRAPPER_DISALLOWED_TOOLS="$DISALLOWED_TOOLS" \
  WRAPPER_TOOLS_OVERRIDE="$TOOLS_OVERRIDE" \
  WRAPPER_SYSTEM_PROMPT="$SYSTEM_PROMPT" \
  WRAPPER_APPEND_SYSTEM_PROMPT="$APPEND_SYSTEM_PROMPT" \
  WRAPPER_JSON_SCHEMA="$JSON_SCHEMA" \
  WRAPPER_NO_SESSION_PERSISTENCE="$NO_SESSION_PERSISTENCE" \
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
permission_mode = os.environ.get("WRAPPER_PERMISSION_MODE") or "bypassPermissions"
bare_mode = os.environ.get("WRAPPER_BARE_MODE", "1") != "0"
files_touched = json.loads(os.environ.get("WRAPPER_FILES_TOUCHED") or "[]")
max_turns = int(os.environ["WRAPPER_MAX_TURNS"]) if os.environ.get("WRAPPER_MAX_TURNS") else None
effort = os.environ.get("WRAPPER_EFFORT") or None
max_budget_usd = float(os.environ["WRAPPER_MAX_BUDGET_USD"]) if os.environ.get("WRAPPER_MAX_BUDGET_USD") else None
fallback_model = os.environ.get("WRAPPER_FALLBACK_MODEL") or None
allowed_tools_raw = os.environ.get("WRAPPER_ALLOWED_TOOLS") or ""
disallowed_tools_raw = os.environ.get("WRAPPER_DISALLOWED_TOOLS") or ""
tools_override_raw = os.environ.get("WRAPPER_TOOLS_OVERRIDE") or ""
system_prompt_raw = os.environ.get("WRAPPER_SYSTEM_PROMPT") or ""
append_system_prompt_raw = os.environ.get("WRAPPER_APPEND_SYSTEM_PROMPT") or ""
json_schema_raw = os.environ.get("WRAPPER_JSON_SCHEMA") or ""
no_session_persistence = os.environ.get("WRAPPER_NO_SESSION_PERSISTENCE") == "1"

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
actual_model = None
provider_name = None
provider_fallback = False
commands_run = []
pending_bash_inputs = {}

def split_tools(raw):
    if not raw:
        return []
    return [part for part in raw.replace(",", " ").split() if part]

def preview_text(raw, limit=240):
    if not raw:
        return None
    text = raw.strip()
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 3] + "..."

def parse_json_schema(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return preview_text(raw, 800)

def add_command(command):
    if not isinstance(command, str):
        return
    command = command.strip()
    if command and command not in commands_run:
        commands_run.append(command)

if provider_stats:
    parts = [part.strip() for part in provider_stats.split("|")]
    if len(parts) >= 2 and parts[1]:
        provider_segment = parts[1]
        if "/" in provider_segment:
            provider_name, provider_model = provider_segment.split("/", 1)
            if provider_model and not actual_model:
                actual_model = provider_model
        else:
            provider_name = provider_segment
    provider_fallback = "(fallback)" in provider_stats
elif model_hint and "/" in model_hint:
    provider_name, inferred_model = model_hint.split("/", 1)
    if inferred_model and not actual_model:
        actual_model = inferred_model

for line in stdout_text.splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        parsed_line = json.loads(line)
    except Exception:
        continue
    if not isinstance(parsed_line, dict):
        continue
    if parsed_line.get("type") == "stream_event":
        event = parsed_line.get("event")
        if isinstance(event, dict):
            if event.get("type") == "content_block_start":
                block = event.get("content_block") or event.get("contentBlock")
                index = event.get("index")
                if (
                    isinstance(block, dict)
                    and block.get("type") == "tool_use"
                    and block.get("name") == "Bash"
                    and isinstance(index, int)
                ):
                    input_value = block.get("input")
                    if isinstance(input_value, dict):
                        add_command(input_value.get("command"))
                    else:
                        pending_bash_inputs[index] = ""
            elif (
                event.get("type") == "content_block_delta"
                and isinstance(event.get("index"), int)
                and event["index"] in pending_bash_inputs
            ):
                delta = event.get("delta")
                if isinstance(delta, dict) and delta.get("type") == "input_json_delta":
                    pending_bash_inputs[event["index"]] += str(delta.get("partial_json") or "")
            elif event.get("type") == "content_block_stop":
                index = event.get("index")
                if isinstance(index, int) and index in pending_bash_inputs:
                    raw_input = pending_bash_inputs.pop(index)
                    try:
                        parsed_input = json.loads(raw_input)
                    except Exception:
                        parsed_input = None
                    if isinstance(parsed_input, dict):
                        add_command(parsed_input.get("command"))
        if isinstance(event, dict) and event.get("type") == "message_start":
            message = event.get("message")
            if isinstance(message, dict):
                model_value = message.get("model")
                if isinstance(model_value, str) and model_value.strip() and not actual_model:
                    actual_model = model_value.strip()
    elif parsed_line.get("type") == "assistant":
        message = parsed_line.get("message")
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, list):
                for block in content:
                    if (
                        isinstance(block, dict)
                        and block.get("type") == "tool_use"
                        and block.get("name") == "Bash"
                        and isinstance(block.get("input"), dict)
                    ):
                        add_command(block["input"].get("command"))
            model_value = message.get("model")
            if isinstance(model_value, str) and model_value.strip() and not actual_model:
                actual_model = model_value.strip()

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
if not summary and status == "success":
    summary = "Completed successfully."

envelope = {
    "type": "wrapper_result",
    "status": status,
    "summary": summary,
    "output": output,
    "error": error_text,
    "workdir": workdir,
    "model": actual_model or resolved_model,
    "requestedModel": resolved_model,
    "durationMs": duration_ms,
    "timeoutSec": timeout_sec,
    "sessionId": session_id,
    "costUsd": cost_usd,
    "usage": usage,
    "stopReason": stop_reason,
    "providerStats": provider_stats,
    "provider": provider_name,
    "providerFallback": provider_fallback,
    "actualModel": actual_model,
    "memoryBridgeEnabled": memory_bridge_enabled,
    "memoryContextInjected": memory_context_injected,
    "permissionMode": permission_mode,
    "bareMode": bare_mode,
    "maxTurns": max_turns,
    "effort": effort,
    "maxBudgetUsd": max_budget_usd,
    "fallbackModel": fallback_model,
    "allowedTools": split_tools(allowed_tools_raw),
    "disallowedTools": split_tools(disallowed_tools_raw),
    "tools": split_tools(tools_override_raw),
    "systemPrompt": preview_text(system_prompt_raw),
    "appendSystemPrompt": preview_text(append_system_prompt_raw),
    "hasCustomPrompt": bool(system_prompt_raw.strip() or append_system_prompt_raw.strip()),
    "jsonSchema": parse_json_schema(json_schema_raw),
    "noSessionPersistence": no_session_persistence,
    "filesTouched": files_touched,
    "commandsRun": commands_run,
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

  BRIDGE_RECORD_JSON="$envelope_json" "$BRIDGE_SCRIPT" record-json "$USER_PROMPT" "${WORKDIR:-cli}" >/dev/null 2>&1 || true
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
    --max-turns)
      MAX_TURNS="$2"
      shift 2
      ;;
    --effort)
      EFFORT="$2"
      shift 2
      ;;
    --max-budget-usd)
      MAX_BUDGET_USD="$2"
      shift 2
      ;;
    --fallback-model)
      FALLBACK_MODEL="$2"
      shift 2
      ;;
    --allowed-tools|--allowedTools)
      ALLOWED_TOOLS="$2"
      shift 2
      ;;
    --disallowed-tools|--disallowedTools)
      DISALLOWED_TOOLS="$2"
      shift 2
      ;;
    --tools)
      TOOLS_OVERRIDE="$2"
      shift 2
      ;;
    --system-prompt)
      SYSTEM_PROMPT="$2"
      shift 2
      ;;
    --append-system-prompt)
      APPEND_SYSTEM_PROMPT="$2"
      shift 2
      ;;
    --json-schema)
      JSON_SCHEMA="$2"
      shift 2
      ;;
    --add-dir)
      ADDITIONAL_DIRS+=("$2")
      shift 2
      ;;
    --no-persist)
      NO_SESSION_PERSISTENCE=1
      shift
      ;;
    --fork-session)
      FORK_SESSION=1
      shift
      ;;
    --output-format)
      OUTPUT_FORMAT="$2"
      shift 2
      ;;
    --permission-mode)
      PERMISSION_MODE="$2"
      shift 2
      ;;
    --bare)
      USE_BARE=1
      shift
      ;;
    --no-bare)
      USE_BARE=0
      shift
      ;;
    --no-memory)
      FC_MEMORY_BRIDGE=0
      shift
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
  echo "Usage: freeclaude-run.sh [--model MODEL] [--workdir DIR] [--timeout SECS] [--resume SESSION_ID] [--fork-session] [--max-turns N] [--effort LEVEL] [--max-budget-usd USD] [--fallback-model MODEL] [--allowed-tools TOOLS] [--disallowed-tools TOOLS] [--tools TOOLS] [--system-prompt TEXT] [--append-system-prompt TEXT] [--json-schema JSON] [--add-dir DIR] [--no-persist] [--permission-mode MODE] [--bare|--no-bare] [--no-memory] [--output-format text|json|stream-json] \"prompt\""
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

if [[ -z "$PERMISSION_MODE" ]]; then
  echo "Error: Permission mode must not be empty"
  exit 1
fi

if [[ "$USE_BARE" != "0" && "$USE_BARE" != "1" ]]; then
  echo "Error: FC_BARE_MODE must be 0 or 1"
  exit 1
fi

if [[ "$PREFER_ENV_OPENROUTER" != "auto" && "$PREFER_ENV_OPENROUTER" != "0" && "$PREFER_ENV_OPENROUTER" != "1" ]]; then
  echo "Error: FC_PREFER_ENV_OPENROUTER must be auto, 0, or 1"
  exit 1
fi

if [[ -n "$MAX_TURNS" ]] && ! [[ "$MAX_TURNS" =~ ^[0-9]+$ ]]; then
  echo "Error: --max-turns must be a positive integer"
  exit 1
fi

if [[ -n "$EFFORT" ]]; then
  case "$EFFORT" in
    low|medium|high|max)
      ;;
    *)
      echo "Error: --effort must be one of low, medium, high, max"
      exit 1
      ;;
  esac
fi

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

if [[ "${ADDITIONAL_DIRS[*]-}" != "" ]]; then
  NORMALIZED_ADDITIONAL_DIRS=()
  for extra_dir in "${ADDITIONAL_DIRS[@]}"; do
    if [[ ! -d "$extra_dir" ]]; then
      echo "Error: Additional directory does not exist: $extra_dir"
      exit 1
    fi
    NORMALIZED_ADDITIONAL_DIRS+=("$(cd "$extra_dir" && pwd)")
  done
  ADDITIONAL_DIRS=("${NORMALIZED_ADDITIONAL_DIRS[@]}")
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

COMMON_ARGS=()
if [[ "$USE_BARE" == "1" ]]; then
  COMMON_ARGS+=("--bare")
fi
COMMON_ARGS+=("--permission-mode" "$PERMISSION_MODE")
if [[ -n "$MODEL" ]]; then
  COMMON_ARGS+=("--model" "$MODEL")
fi
if [[ -n "$RESUME_SESSION_ID" ]]; then
  COMMON_ARGS+=("--resume" "$RESUME_SESSION_ID")
fi
if [[ "$FORK_SESSION" == "1" ]]; then
  COMMON_ARGS+=("--fork-session")
fi
if [[ -n "$MAX_TURNS" ]]; then
  COMMON_ARGS+=("--max-turns" "$MAX_TURNS")
fi
if [[ -n "$EFFORT" ]]; then
  COMMON_ARGS+=("--effort" "$EFFORT")
fi
if [[ -n "$MAX_BUDGET_USD" ]]; then
  COMMON_ARGS+=("--max-budget-usd" "$MAX_BUDGET_USD")
fi
if [[ -n "$FALLBACK_MODEL" ]]; then
  COMMON_ARGS+=("--fallback-model" "$FALLBACK_MODEL")
fi
if [[ -n "$ALLOWED_TOOLS" ]]; then
  COMMON_ARGS+=("--allowed-tools" "$ALLOWED_TOOLS")
fi
if [[ -n "$DISALLOWED_TOOLS" ]]; then
  COMMON_ARGS+=("--disallowed-tools" "$DISALLOWED_TOOLS")
fi
if [[ -n "$TOOLS_OVERRIDE" ]]; then
  COMMON_ARGS+=("--tools" "$TOOLS_OVERRIDE")
fi
if [[ -n "$SYSTEM_PROMPT" ]]; then
  COMMON_ARGS+=("--system-prompt" "$SYSTEM_PROMPT")
fi
if [[ -n "$APPEND_SYSTEM_PROMPT" ]]; then
  COMMON_ARGS+=("--append-system-prompt" "$APPEND_SYSTEM_PROMPT")
fi
if [[ -n "$JSON_SCHEMA" ]]; then
  COMMON_ARGS+=("--json-schema" "$JSON_SCHEMA")
fi
if [[ "$NO_SESSION_PERSISTENCE" == "1" ]]; then
  COMMON_ARGS+=("--no-session-persistence")
fi
COMMON_ARGS+=("--add-dir" "$WORKDIR")
if [[ "${ADDITIONAL_DIRS[*]-}" != "" ]]; then
  for extra_dir in "${ADDITIONAL_DIRS[@]}"; do
    COMMON_ARGS+=("--add-dir" "$extra_dir")
  done
fi

cd "$WORKDIR"

STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)
HEAD_BEFORE=""
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  HEAD_BEFORE=$(git rev-parse HEAD 2>/dev/null || true)
fi
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

# Auto-select OpenRouter when key available and model not overridden
if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
  export FREECLAUDE_PREFER_ENV_OPENROUTER=1
else
  unset FREECLAUDE_PREFER_ENV_OPENROUTER
fi

CMD_BASE=("$FC_BINARY" "--print" "${COMMON_ARGS[@]}" "--" "$PROMPT")

START_TIME=$(date +%s)
EXIT_CODE=0
DURATION_MS=0
COST_LINE=""

if [[ "$OUTPUT_FORMAT" == "stream-json" ]]; then
  emit_wrapper_event "init"
  STREAM_CMD=(
    "$FC_BINARY"
    "--print"
    "${COMMON_ARGS[@]}"
    "--verbose"
    "--output-format"
    "stream-json"
    "--include-partial-messages"
  )
  STREAM_CMD+=("--" "$PROMPT")

  set +e
  perl -e "
    alarm $TIMEOUT;
    \$SIG{ALRM} = sub {
      if (defined \$pid) {
        kill 'TERM', \$pid;
        select undef, undef, undef, 0.25;
        kill 'KILL', \$pid if kill 0, \$pid;
      }
      print STDERR qq(FreeClaude timed out after ${TIMEOUT}s\n);
      exit 124;
    };
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

  ENVELOPE_JSON="$(build_result_envelope "$STATUS" "$STDOUT_FILE" "$STDERR_FILE" "$HEAD_BEFORE")"
  persist_runtime_state "$ENVELOPE_JSON"
  printf '%s\n' "$ENVELOPE_JSON" || true

  if [[ "$STATUS" == "success" ]]; then
    record_memory_summary "$ENVELOPE_JSON"
    exit 0
  fi
  exit "$EXIT_CODE"
fi

if [[ "$OUTPUT_FORMAT" == "json" ]]; then
  JSON_CMD=(
    "$FC_BINARY"
    "--print"
    "${COMMON_ARGS[@]}"
    "--verbose"
    "--output-format"
    "stream-json"
    "--include-partial-messages"
    "--"
    "$PROMPT"
  )

  set +e
  perl -e "
    alarm $TIMEOUT;
    \$SIG{ALRM} = sub {
      if (defined \$pid) {
        kill 'TERM', \$pid;
        select undef, undef, undef, 0.25;
        kill 'KILL', \$pid if kill 0, \$pid;
      }
      print STDERR qq(FreeClaude timed out after ${TIMEOUT}s\n);
      exit 124;
    };
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

  ENVELOPE_JSON="$(build_result_envelope "$STATUS" "$STDOUT_FILE" "$STDERR_FILE" "$HEAD_BEFORE")"
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
  \$SIG{ALRM} = sub {
    if (defined \$pid) {
      kill 'TERM', \$pid;
      select undef, undef, undef, 0.25;
      kill 'KILL', \$pid if kill 0, \$pid;
    }
    print STDERR qq(FreeClaude timed out after ${TIMEOUT}s\n);
    exit 124;
  };
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

  TEXT_ENVELOPE="$(build_result_envelope "success" "$STDOUT_FILE" "$STDERR_FILE" "$HEAD_BEFORE")"
  persist_runtime_state "$TEXT_ENVELOPE"
  record_memory_summary "$TEXT_ENVELOPE"
else
  TEXT_ENVELOPE="$(build_result_envelope "error" "$STDOUT_FILE" "$STDERR_FILE" "$HEAD_BEFORE")"
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
