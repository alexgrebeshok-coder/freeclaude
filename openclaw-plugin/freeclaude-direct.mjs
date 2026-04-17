import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { buildTask } from "./freeclaude-backend.mjs";

const DEFAULT_BINARY = "/opt/homebrew/bin/freeclaude";
const MEMORY_BRIDGE = path.join(homedir(), ".openclaw/workspace/tools/fc-memory-bridge.sh");

export const DIRECT_SIGTERM_GRACE_MS = 3000;

/**
 * Run FreeClaude CLI directly, bypassing the bash wrapper (freeclaude-run.sh).
 *
 * Spawns the freeclaude binary with `--print` mode, handles timeout
 * (SIGTERM → 3s grace → SIGKILL), optionally injects memory bridge context,
 * and returns a `wrapper_result` envelope identical to the one produced by
 * the bash wrapper.
 *
 * @param {object} options
 * @param {string}  [options.binary]           - Path to freeclaude binary (default: /opt/homebrew/bin/freeclaude)
 * @param {string}  [options.workdir]          - Working directory for the CLI
 * @param {string}   options.task              - The prompt / task text
 * @param {string}  [options.mode]             - Task mode: code|review|debug|explain|test|refactor
 * @param {string}  [options.model]            - Model override
 * @param {number}  [options.timeoutSeconds]   - Timeout in seconds (default: 120)
 * @param {boolean} [options.includeMemory]    - Inject memory bridge context (default: true)
 * @param {string}  [options.sessionKey]       - Logical session key for persistence
 * @param {string}  [options.resumeSessionId]  - FreeClaude session ID to resume
 * @param {boolean} [options.forkSession]      - Fork the resumed session
 * @param {string}  [options.permissionMode]   - Permission mode override
 * @param {boolean} [options.bareMode]         - Enable/disable bare mode
 * @param {number}  [options.maxTurns]         - Max agentic turns
 * @param {string}  [options.effort]           - Effort level
 * @param {number}  [options.maxBudgetUsd]     - Max budget in USD
 * @param {string}  [options.fallbackModel]    - Fallback model
 * @param {string}  [options.allowedTools]     - Allowed tools list
 * @param {string}  [options.disallowedTools]  - Disallowed tools list
 * @param {string}  [options.tools]            - Tools override
 * @param {string}  [options.systemPrompt]     - Custom system prompt
 * @param {string}  [options.appendSystemPrompt] - Append to system prompt
 * @param {string}  [options.jsonSchema]       - JSON schema for structured output
 * @param {boolean} [options.noPersist]        - Disable session persistence
 * @param {string[]} [options.extraDirs]       - Additional directories to add
 * @param {string}  [options.cwd]              - Override cwd for the child process
 * @returns {Promise<object>} A wrapper_result envelope
 */
export async function runDirectSync({
  binary = DEFAULT_BINARY,
  workdir,
  task,
  mode = "code",
  model,
  timeoutSeconds = 120,
  includeMemory = true,
  sessionKey,
  resumeSessionId,
  forkSession = false,
  permissionMode,
  bareMode,
  maxTurns,
  effort,
  maxBudgetUsd,
  fallbackModel,
  allowedTools,
  disallowedTools,
  tools,
  systemPrompt,
  appendSystemPrompt,
  jsonSchema,
  noPersist = false,
  extraDirs = [],
  cwd,
  outputFormat = "json",
} = {}) {
  const startTime = Date.now();

  try {
    const spec = createDirectSpawnSpec({
      binary,
      workdir,
      task,
      mode,
      model,
      includeMemory,
      resumeSessionId,
      forkSession,
      permissionMode,
      bareMode,
      maxTurns,
      effort,
      maxBudgetUsd,
      fallbackModel,
      allowedTools,
      disallowedTools,
      tools,
      systemPrompt,
      appendSystemPrompt,
      jsonSchema,
      noPersist,
      extraDirs,
      cwd,
      outputFormat,
    });

    const result = await spawnWithTimeout(spec.command, spec.args, {
      cwd: spec.cwd,
      timeoutMs: timeoutSeconds * 1000,
    });

    const envelope = buildDirectEnvelope({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      model,
      startTime,
      timeoutSeconds,
      workdir,
      memoryBridgeEnabled: spec.memoryBridgeEnabled,
      memoryContextInjected: spec.memoryContextInjected,
      permissionMode,
      bareMode,
      maxTurns,
    });
    recordMemoryBridge(envelope, { task, workdir });
    return envelope;
  } catch (err) {
    return makeEnvelope({
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      model,
      startTime,
    });
  }
}

export function createDirectSpawnSpec({
  binary = DEFAULT_BINARY,
  workdir,
  task,
  mode = "code",
  model,
  includeMemory = true,
  resumeSessionId,
  forkSession = false,
  permissionMode,
  bareMode,
  maxTurns,
  effort,
  maxBudgetUsd,
  fallbackModel,
  allowedTools,
  disallowedTools,
  tools,
  systemPrompt,
  appendSystemPrompt,
  jsonSchema,
  noPersist = false,
  extraDirs = [],
  cwd,
  outputFormat = "json",
} = {}) {
  if (!task) {
    throw new Error("No task provided");
  }

  const resolvedBinary = binary || DEFAULT_BINARY;
  if (
    (path.isAbsolute(resolvedBinary) || resolvedBinary.includes(path.sep)) &&
    !existsSync(resolvedBinary)
  ) {
    throw new Error(`FreeClaude binary not found: ${resolvedBinary}`);
  }

  let prompt = buildTask(mode, task);
  let memoryBridgeEnabled = false;
  let memoryContextInjected = false;

  if (includeMemory !== false) {
    const memoryContext = injectMemoryBridge(workdir, prompt);
    memoryBridgeEnabled = true;
    if (memoryContext) {
      memoryContextInjected = true;
      prompt = `${memoryContext}\n\n--- User Request ---\n${prompt}`;
    }
  }

  return {
    command: resolvedBinary,
    args: buildCliArgs({
      model,
      resumeSessionId,
      forkSession,
      permissionMode,
      bareMode,
      maxTurns,
      effort,
      maxBudgetUsd,
      fallbackModel,
      allowedTools,
      disallowedTools,
      tools,
      systemPrompt,
      appendSystemPrompt,
      jsonSchema,
      noPersist,
      workdir,
      extraDirs,
      prompt,
      outputFormat,
    }),
    cwd: cwd || workdir || process.cwd(),
    memoryBridgeEnabled,
    memoryContextInjected,
  };
}

/**
 * Spawn the memory bridge inject command and return the context string.
 * Returns empty string on failure (non-critical).
 */
function injectMemoryBridge(workdir, query) {
  if (!existsSync(MEMORY_BRIDGE)) {
    return "";
  }
  try {
    const output = execFileSync(MEMORY_BRIDGE, ["inject", workdir || "", query || ""], {
      timeout: 10_000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return (output || "").trim();
  } catch {
    return "";
  }
}

function shouldRecordMemory(task) {
  const loweredPrompt = String(task || "").trim().toLowerCase();
  if (!loweredPrompt) return false;
  if (process.env.FC_MEMORY_BRIDGE === "0" || process.env.FC_RECORD_MEMORY === "0") {
    return false;
  }
  if (process.env.FC_RECORD_MEMORY_FORCE === "1") {
    return true;
  }
  return !(
    loweredPrompt.startsWith("reply with exactly:") || loweredPrompt.includes("probe")
  );
}

function recordMemoryBridge(envelope, { task, workdir } = {}) {
  if (!shouldRecordMemory(task) || !existsSync(MEMORY_BRIDGE)) {
    return;
  }
  try {
    execFileSync(MEMORY_BRIDGE, ["record-json", task || "", workdir || "cli"], {
      timeout: 10_000,
      encoding: "utf-8",
      stdio: ["ignore", "ignore", "ignore"],
      env: {
        ...process.env,
        BRIDGE_RECORD_JSON: JSON.stringify(envelope),
      },
    });
  } catch {
    // Best-effort sync only.
  }
}

/**
 * Build the freeclaude CLI argument array.
 */
function buildCliArgs({
  model,
  resumeSessionId,
  forkSession,
  permissionMode,
  bareMode,
  maxTurns,
  effort,
  maxBudgetUsd,
  fallbackModel,
  allowedTools,
  disallowedTools,
  tools,
  systemPrompt,
  appendSystemPrompt,
  jsonSchema,
  noPersist,
  workdir,
  extraDirs,
  prompt,
  outputFormat,
}) {
  const args = ["--print", "--output-format", outputFormat || "json"];

  if (model) args.push("--model", model);
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  if (forkSession === true) args.push("--fork-session");

  if (permissionMode) args.push("--permission-mode", permissionMode);

  if (bareMode === true) args.push("--bare");
  else if (bareMode === false) args.push("--no-bare");

  if (maxTurns) args.push("--max-turns", String(maxTurns));
  if (effort) args.push("--effort", effort);
  if (maxBudgetUsd) args.push("--max-budget-usd", String(maxBudgetUsd));
  if (fallbackModel) args.push("--fallback-model", fallbackModel);
  if (allowedTools) args.push("--allowed-tools", allowedTools);
  if (disallowedTools) args.push("--disallowed-tools", disallowedTools);
  if (tools) args.push("--tools", tools);
  if (systemPrompt) args.push("--system-prompt", systemPrompt);
  if (appendSystemPrompt) args.push("--append-system-prompt", appendSystemPrompt);
  if (jsonSchema) args.push("--json-schema", jsonSchema);
  if (noPersist === true) args.push("--no-session-persistence");

  if (workdir) args.push("--add-dir", workdir);
  for (const dir of extraDirs) {
    if (dir) args.push("--add-dir", dir);
  }

  args.push("--", prompt);
  return args;
}

/**
 * Spawn a child process with a two-phase timeout: SIGTERM, then SIGKILL after grace period.
 *
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string, timedOut: boolean}>}
 */
function spawnWithTimeout(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    // Two-phase timeout: SIGTERM → wait 3s → SIGKILL
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch { /* already dead */ }

      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch { /* already dead */ }
      }, DIRECT_SIGTERM_GRACE_MS);
    }, timeoutMs);

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? 1, stdout, stderr, timedOut });
    };

    proc.on("close", (code) => finish(code));
    proc.on("error", (err) => {
      stderr += `\nSpawn error: ${err.message}`;
      finish(1);
    });
  });
}

/**
 * Parse freeclaude JSON output to extract session_id, cost, model, result text, etc.
 */
function parseFreeclaudeOutput(stdout) {
  let resultPayload = null;
  let sessionId = null;
  let costUsd = null;
  let usage = null;
  let stopReason = null;
  let actualModel = null;
  let resultText = "";

  // First try to parse the entire stdout as a single JSON object (--output-format json)
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed === "object") {
      if (parsed.type === "result") {
        resultPayload = parsed;
        resultText = String(parsed.result || "").trim();
        sessionId = parsed.session_id || null;
        costUsd = parsed.total_cost_usd ?? null;
        usage = parsed.usage ?? null;
        stopReason = parsed.stop_reason || null;
        const modelUsage = parsed.modelUsage;
        if (modelUsage && typeof modelUsage === "object" && Object.keys(modelUsage).length) {
          actualModel = Object.keys(modelUsage)[0];
        }
        return { resultPayload, sessionId, costUsd, usage, stopReason, actualModel, resultText };
      }
    }
  } catch { /* not a single JSON blob, try line-by-line */ }

  // Line-by-line scan (handles streaming JSON or multi-line output)
  const lines = String(stdout || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;

    // Stream event — look for message_start to get model info
    if (parsed.type === "stream_event" && parsed.event) {
      const event = parsed.event;
      if (event.type === "message_start" && event.message) {
        const m = event.message.model;
        if (typeof m === "string" && m.trim() && !actualModel) {
          actualModel = m.trim();
        }
      }
    }

    // Assistant message — extract model
    if (parsed.type === "assistant" && parsed.message) {
      const m = parsed.message.model;
      if (typeof m === "string" && m.trim() && !actualModel) {
        actualModel = m.trim();
      }
    }

    // Result object (usually last line)
    if (parsed.type === "result") {
      resultPayload = parsed;
      resultText = String(parsed.result || "").trim();
      sessionId = parsed.session_id || null;
      costUsd = parsed.total_cost_usd ?? null;
      usage = parsed.usage ?? null;
      stopReason = parsed.stop_reason || null;
      const modelUsage = parsed.modelUsage;
      if (!actualModel && modelUsage && typeof modelUsage === "object" && Object.keys(modelUsage).length) {
        actualModel = Object.keys(modelUsage)[0];
      }
    }
  }

  return { resultPayload, sessionId, costUsd, usage, stopReason, actualModel, resultText };
}

/**
 * Build a wrapper_result envelope from spawn results.
 */
export function buildDirectEnvelope({
  exitCode,
  stdout,
  stderr,
  timedOut,
  model,
  startTime,
  timeoutSeconds,
  workdir,
  memoryBridgeEnabled,
  memoryContextInjected,
  permissionMode,
  bareMode,
  maxTurns,
}) {
  const durationMs = Date.now() - startTime;

  if (timedOut) {
    // Still attempt to parse partial output
    const parsed = parseFreeclaudeOutput(stdout);
    return {
      type: "wrapper_result",
      status: "timeout",
      summary: `Timed out after ${timeoutSeconds}s`,
      output: parsed.resultText || stdout.trim(),
      error: `FreeClaude timed out after ${timeoutSeconds}s`,
      workdir: workdir || null,
      model: parsed.actualModel || model || null,
      requestedModel: model || null,
      durationMs,
      timeoutSec: timeoutSeconds,
      sessionId: parsed.sessionId || null,
      costUsd: parsed.costUsd ?? null,
      usage: parsed.usage ?? null,
      stopReason: parsed.stopReason || null,
      actualModel: parsed.actualModel || null,
      memoryBridgeEnabled,
      memoryContextInjected,
      permissionMode: permissionMode || null,
      bareMode: bareMode ?? null,
      maxTurns: maxTurns || null,
      exitCode: exitCode ?? 1,
    };
  }

  const parsed = parseFreeclaudeOutput(stdout);

  // Filter stderr: remove [FreeClaude] info lines
  const filteredStderr = (stderr || "")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("[FreeClaude]"))
    .join("\n")
    .trim();

  const status = exitCode === 0 ? "success" : "error";
  const output = parsed.resultText || stdout.trim();
  const errorText = status !== "success" ? (filteredStderr || output || `FreeClaude exited with code ${exitCode}`) : null;

  // Derive summary: first non-empty line of output
  let summary = "";
  for (const line of (output || "").split(/\r?\n/)) {
    if (line.trim()) {
      summary = line.trim();
      break;
    }
  }
  if (!summary && status === "success") {
    summary = "Completed successfully.";
  }

  const envelope = {
    type: "wrapper_result",
    status,
    summary,
    output,
    error: errorText || null,
    workdir: workdir || null,
    model: parsed.actualModel || model || null,
    requestedModel: model || null,
    durationMs,
    timeoutSec: timeoutSeconds,
    sessionId: parsed.sessionId || null,
    costUsd: parsed.costUsd ?? null,
    usage: parsed.usage ?? null,
    stopReason: parsed.stopReason || null,
    actualModel: parsed.actualModel || null,
    memoryBridgeEnabled,
    memoryContextInjected,
    permissionMode: permissionMode || null,
    bareMode: bareMode ?? null,
    maxTurns: maxTurns || null,
    exitCode: exitCode ?? 0,
  };

  if (parsed.resultPayload) {
    envelope.rawResult = parsed.resultPayload;
  }

  return envelope;
}

/**
 * Create a minimal envelope for early-exit error cases.
 */
function makeEnvelope({ status, error, model, startTime }) {
  return {
    type: "wrapper_result",
    status,
    summary: error || "",
    output: "",
    error,
    workdir: null,
    model: model || null,
    requestedModel: model || null,
    durationMs: Date.now() - startTime,
    timeoutSec: null,
    sessionId: null,
    costUsd: null,
    usage: null,
    stopReason: null,
    actualModel: null,
    memoryBridgeEnabled: false,
    memoryContextInjected: false,
    permissionMode: null,
    bareMode: null,
    maxTurns: null,
    exitCode: 1,
  };
}
