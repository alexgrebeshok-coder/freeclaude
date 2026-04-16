import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createInterface } from "node:readline";
import {
  DEFAULT_STATE_DIR,
  MAX_PERSISTED_RUNS,
  loadPersistedRuns,
  loadPersistedSessions,
  savePersistedRuns,
  savePersistedSessions,
} from "./runtime-state.mjs";
import {
  buildTask,
  getStatusText,
  readString,
  runWrappedSync,
  WrappedRunError,
} from "./freeclaude-backend.mjs";
import {
  DEFAULT_LIST_LIMIT,
  formatRunSummaryList,
  formatSessionSummaryList,
  listRunSummaries,
  listSessionSummaries,
} from "./inspection.mjs";

const RUNS = new Map();
const SESSIONS = new Map();
const MAX_RUNS = MAX_PERSISTED_RUNS;
const PREVIEW_LIMIT = 4000;
let stateLoaded = false;
let stateDir = DEFAULT_STATE_DIR;

function resolveRuntimeConfig(api) {
  const cfg = api.pluginConfig ?? {};
  
  // Auto-detect wrapper: try bundled, then workspace, then PATH
  let wrapper = typeof cfg.wrapper === "string" && cfg.wrapper.trim() ? cfg.wrapper.trim() : "";
  if (!wrapper) {
    // Try bundled wrapper (inside npm package)
    const bundledWrapper = new URL("../tools/freeclaude-run.sh", import.meta.url).pathname;
    if (fs.existsSync(bundledWrapper)) {
      wrapper = bundledWrapper;
    } else {
      // Fallback to workspace tools
      wrapper = api.resolvePath("~/.openclaw/workspace/tools/freeclaude-run.sh");
    }
  } else {
    wrapper = api.resolvePath(wrapper);
  }
  
  const binary = typeof cfg.binary === "string" && cfg.binary.trim() ? cfg.binary.trim() : "freeclaude";
  const defaultModel =
    typeof cfg.defaultModel === "string" && cfg.defaultModel.trim() ? cfg.defaultModel.trim() : "";
  const timeout =
    typeof cfg.timeout === "number" && Number.isFinite(cfg.timeout) ? Math.max(10, Math.floor(cfg.timeout)) : 120;
  const resolvedStateDir = api.resolvePath(
    typeof cfg.stateDir === "string" && cfg.stateDir.trim() ? cfg.stateDir.trim() : DEFAULT_STATE_DIR,
  );

  return { wrapper, binary, defaultModel, timeout, stateDir: resolvedStateDir };
}

function firstNonEmptyLine(text) {
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function trimPreview(text, limit = PREVIEW_LIMIT) {
  if (!text) return "";
  if (text.length <= limit) return text;
  return text.slice(-limit);
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function extractAssistantText(message) {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function resolveSessionKey(input = {}, context = {}) {
  const directCandidates = [
    input.sessionKey,
    input.threadKey,
    input.conversationKey,
    context.sessionKey,
    context.conversationKey,
    context.threadKey,
    context?.session?.id,
    context?.conversation?.id,
    context?.thread?.id,
    context?.channel?.id,
    context?.event?.sessionId,
    context?.event?.conversationId,
    context?.event?.threadId,
    context?.event?.channelId,
  ];

  for (const candidate of directCandidates) {
    const value = readString(candidate);
    if (value) {
      return value.slice(0, 300);
    }
  }

  const pairCandidates = [
    [input.channelId, input.threadId],
    [context.channelId, context.threadId],
    [context?.message?.channelId, context?.message?.threadId],
    [context?.event?.channelId, context?.event?.threadId],
  ];

  for (const [channelId, threadId] of pairCandidates) {
    const channel = readString(channelId);
    const thread = readString(threadId);
    if (channel && thread) {
      return `${channel}:${thread}`.slice(0, 300);
    }
  }

  for (const candidate of [
    input.channelId,
    input.threadId,
    input.conversationId,
    input.sessionId,
    context.channelId,
    context.threadId,
    context.conversationId,
    context.sessionId,
    context?.message?.channelId,
    context?.message?.threadId,
  ]) {
    const value = readString(candidate);
    if (value) {
      return value.slice(0, 300);
    }
  }

  return "";
}

function ensureStateLoaded(api) {
  const runtime = resolveRuntimeConfig(api);
  if (stateLoaded && stateDir === runtime.stateDir) {
    return;
  }

  stateDir = runtime.stateDir;
  RUNS.clear();
  for (const [runId, run] of loadPersistedRuns(stateDir)) {
    RUNS.set(runId, run);
  }

  SESSIONS.clear();
  for (const [sessionKey, session] of loadPersistedSessions(stateDir)) {
    SESSIONS.set(sessionKey, session);
  }

  stateLoaded = true;
  savePersistedRuns(stateDir, RUNS);
}

function persistState(api) {
  ensureStateLoaded(api);
  savePersistedRuns(stateDir, RUNS);
  savePersistedSessions(stateDir, SESSIONS);
}

function persistRun(api, run) {
  RUNS.set(run.runId, run);
  pruneRuns();
  persistState(api);
}

function getRetryBaseInput(run) {
  return {
    task: run.task,
    mode: run.mode,
    workdir: run.workdir,
    model: run.model,
    timeout: run.timeout,
    includeMemory: run.includeMemory !== false,
    sessionKey: run.sessionKey,
    resume: true,
    resumeSessionId: run.freeClaudeSessionId || run.resumeSessionId || "",
    forkSession: false,
    parentRunId: run.runId,
  };
}

function createRunRecord(normalized) {
  const now = Date.now();
  return {
    runId: randomUUID(),
    status: "running",
    task: normalized.task,
    mode: normalized.mode,
    workdir: normalized.workdir,
    model: normalized.model || normalized.runtime.defaultModel || undefined,
    timeout: normalized.timeout,
    includeMemory: normalized.includeMemory,
    sessionKey: normalized.sessionKey || "",
    resumeSessionId: normalized.resumeSessionId || "",
    freeClaudeSessionId: "",
    forkSession: normalized.forkSession === true,
    parentRunId: normalized.parentRunId || "",
    summary: "",
    partialOutput: "",
    lastEvent: normalized.resumeSessionId ? "resuming" : "spawned",
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    error: null,
    result: null,
    exitCode: null,
    proc: null,
  };
}

function updateSessionBinding(api, run, envelope = run.result) {
  const sessionId = readString(envelope?.sessionId || run.freeClaudeSessionId);
  if (!run.sessionKey || !sessionId) {
    return;
  }

  run.freeClaudeSessionId = sessionId;
  SESSIONS.set(run.sessionKey, {
    sessionKey: run.sessionKey,
    freeClaudeSessionId: sessionId,
    workdir: run.workdir,
    model: envelope?.model || run.model || "",
    mode: run.mode,
    lastRunId: run.runId,
    lastStatus: run.status,
    summary: envelope?.summary || run.summary || "",
    updatedAt: Date.now(),
  });
  persistState(api);
}

function applyWrapperResult(api, run, payload) {
  run.result = { ...payload, runId: run.runId, sessionKey: run.sessionKey || undefined };
  run.summary = payload.summary || run.summary;
  run.partialOutput = trimPreview(payload.output || run.partialOutput);
  run.status = payload.status === "success" ? "completed" : "failed";
  run.finishedAt = Date.now();
  run.updatedAt = run.finishedAt;
  run.error = payload.error || run.error;
  run.exitCode = payload.exitCode;
  run.lastEvent = "wrapper_result";
  run.freeClaudeSessionId = readString(payload.sessionId || run.freeClaudeSessionId);
  persistRun(api, run);
  updateSessionBinding(api, run, payload);
}

function cancelRun(api, run) {
  if (run.status === "running" && run.proc) {
    run.proc.kill("SIGTERM");
    run.status = "cancelled";
    run.finishedAt = Date.now();
    run.updatedAt = run.finishedAt;
    run.lastEvent = "cancelled";
    persistRun(api, run);
  }
  return summarizeRun(run);
}

function normalizeInput(api, input = {}, context = {}) {
  ensureStateLoaded(api);
  let sourceInput = { ...input };
  const retryRunId = readString(sourceInput.retryRunId);
  if (retryRunId) {
    sourceInput = { ...getRetryBaseInput(getRun(api, retryRunId)), ...sourceInput };
  }

  const runtime = resolveRuntimeConfig(api);
  const task = typeof sourceInput.task === "string" ? sourceInput.task.trim() : "";
  if (!task) {
    throw new Error("task is required");
  }

  const allowedModes = ["code", "review", "debug", "explain", "test", "refactor"];
  const mode =
    typeof sourceInput.mode === "string" && allowedModes.includes(sourceInput.mode) ? sourceInput.mode : "code";
  const workdir =
    typeof sourceInput.workdir === "string" && sourceInput.workdir.trim()
      ? api.resolvePath(sourceInput.workdir.trim())
      : process.cwd();
  const model =
    typeof sourceInput.model === "string" && sourceInput.model.trim() ? sourceInput.model.trim() : runtime.defaultModel;
  const timeout =
    typeof sourceInput.timeout === "number" && Number.isFinite(sourceInput.timeout)
      ? Math.max(10, Math.floor(sourceInput.timeout))
      : runtime.timeout;
  const includeMemory = sourceInput.includeMemory !== false;
  const background = sourceInput.background === true;
  const sessionKey = resolveSessionKey(sourceInput, context);
  const explicitResumeSessionId = readString(sourceInput.resumeSessionId || sourceInput.resume);
  const autoResume = sourceInput.resume !== false;
  const mappedResumeSessionId =
    !explicitResumeSessionId && autoResume && sessionKey ? readString(SESSIONS.get(sessionKey)?.freeClaudeSessionId) : "";
  const resumeSessionId = explicitResumeSessionId || mappedResumeSessionId;
  const forkSession = sourceInput.forkSession === true;
  const parentRunId = readString(sourceInput.parentRunId || sourceInput.retryRunId);

  if (!fs.existsSync(runtime.wrapper)) {
    throw new Error(`wrapper not found: ${runtime.wrapper}`);
  }
  if (!fs.existsSync(workdir)) {
    throw new Error(`workdir not found: ${workdir}`);
  }

  return {
    runtime,
    task,
    mode,
    workdir,
    model,
    timeout,
    includeMemory,
    background,
    sessionKey,
    resumeSessionId,
    forkSession,
    parentRunId,
    builtTask: buildTask(mode, task),
  };
}

function createWrapperArgs(input, outputFormat) {
  const args = ["--workdir", input.workdir, "--timeout", String(input.timeout), "--output-format", outputFormat];
  if (input.model) {
    args.push("--model", input.model);
  }
  if (input.resumeSessionId) {
    args.push("--resume", input.resumeSessionId);
  }
  if (input.forkSession) {
    args.push("--fork-session");
  }
  args.push(input.builtTask);
  return args;
}

function toDisplayText(result) {
  const text = String(result?.output || "").trim();
  if (!text) {
    return result?.summary || "FreeClaude completed.";
  }
  return text;
}

function summarizeRun(run) {
  return {
    runId: run.runId,
    status: run.status,
    task: run.task,
    mode: run.mode,
    workdir: run.workdir,
    model: run.model,
    timeout: run.timeout,
    sessionKey: run.sessionKey || undefined,
    resumeSessionId: run.resumeSessionId || undefined,
    freeClaudeSessionId: run.freeClaudeSessionId || run.result?.sessionId || undefined,
    forkSession: run.forkSession === true,
    parentRunId: run.parentRunId || undefined,
    summary: run.summary,
    lastEvent: run.lastEvent,
    partialOutput: run.partialOutput,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    error: run.error,
    hasResult: Boolean(run.result),
    exitCode: run.exitCode,
  };
}

function pruneRuns() {
  const entries = Array.from(RUNS.values()).sort((a, b) => a.startedAt - b.startedAt);
  while (entries.length > MAX_RUNS) {
    const run = entries.shift();
    if (run) {
      RUNS.delete(run.runId);
    }
  }
}

function applyStreamEvent(api, run, payload) {
  if (!payload || typeof payload !== "object") return;

  run.updatedAt = Date.now();

  if (payload.type === "wrapper_event") {
    run.lastEvent = payload.event || "wrapper_event";
    return;
  }

  if (payload.type === "stream_event" && payload.event) {
    run.lastEvent = payload.event.type || "stream_event";
    if (
      payload.event.type === "content_block_delta" &&
      payload.event.delta?.type === "text_delta" &&
      typeof payload.event.delta.text === "string"
    ) {
      run.partialOutput = trimPreview(run.partialOutput + payload.event.delta.text);
      run.summary = firstNonEmptyLine(run.partialOutput) || run.summary;
    }
    return;
  }

  if (payload.type === "assistant" && payload.message) {
    const assistantText = extractAssistantText(payload.message);
    if (assistantText) {
      run.partialOutput = trimPreview(assistantText);
      run.summary = firstNonEmptyLine(run.partialOutput) || run.summary;
    }
    run.lastEvent = "assistant";
    return;
  }

  if (payload.type === "result") {
    const resultText = String(payload.result || "").trim();
    if (resultText) {
      run.partialOutput = trimPreview(resultText);
      run.summary = firstNonEmptyLine(resultText) || run.summary;
    }
    run.lastEvent = "result";
    return;
  }

  if (payload.type === "wrapper_result") {
    applyWrapperResult(api, run, payload);
  }
}

function runFreeClaude(api, input = {}, context = {}) {
  const normalized = normalizeInput(api, input, context);
  const run = createRunRecord(normalized);
  persistRun(api, run);

  return runWrappedSync({
    wrapper: normalized.runtime.wrapper,
    binary: normalized.runtime.binary,
    stateDir: normalized.runtime.stateDir,
    workdir: normalized.workdir,
    task: normalized.task,
    mode: normalized.mode,
    model: normalized.model,
    timeoutSeconds: normalized.timeout,
    includeMemory: normalized.includeMemory,
    sessionKey: normalized.sessionKey,
    resumeSessionId: normalized.resumeSessionId,
    forkSession: normalized.forkSession,
    persistBinding: false,
    lastRunId: run.runId,
  })
    .then((result) => {
      applyWrapperResult(api, run, result);
      return { ...result, runId: run.runId, sessionKey: run.sessionKey || undefined };
    })
    .catch((err) => {
      if (err instanceof WrappedRunError && err.envelope) {
        applyWrapperResult(api, run, err.envelope);
      } else {
        run.status = "failed";
        run.error = (err instanceof Error ? err.message : String(err)).trim();
        run.finishedAt = Date.now();
        run.updatedAt = run.finishedAt;
        run.lastEvent = "spawn_error";
        persistRun(api, run);
      }
      throw (err instanceof Error ? err : new Error(String(err)));
    });
}

function startFreeClaudeRun(api, input = {}, context = {}) {
  const normalized = normalizeInput(api, { ...input, background: false }, context);
  const args = createWrapperArgs(normalized, "stream-json");

  const proc = spawn(normalized.runtime.wrapper, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      FC_BINARY: normalized.runtime.binary,
      FC_MEMORY_BRIDGE: normalized.includeMemory ? "1" : "0",
      FC_STATE_DIR: normalized.runtime.stateDir,
      FC_PERSIST_RUN_STATE: "0",
    },
  });

  const run = createRunRecord(normalized);
  run.proc = proc;
  persistRun(api, run);

  const rl = createInterface({ input: proc.stdout });
  rl.on("line", (line) => {
    const parsed = parseJsonLine(line);
    if (parsed) {
      applyStreamEvent(api, run, parsed);
    }
  });

  proc.stderr.on("data", (chunk) => {
    const text = chunk
      .toString()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("[FreeClaude]"))
      .join("\n");
    if (!text) return;
    run.updatedAt = Date.now();
    run.error = text;
  });

  proc.on("close", (code) => {
    run.exitCode = code;
    run.updatedAt = Date.now();
    if (!run.result && run.status !== "cancelled") {
      run.status = code === 0 ? "completed" : "failed";
      run.finishedAt = Date.now();
      run.error = run.error || (code === 0 ? null : `FreeClaude exited with code ${code}`);
      persistRun(api, run);
    } else if (run.status === "cancelled" && !run.finishedAt) {
      run.finishedAt = Date.now();
      persistRun(api, run);
    }
  });

  proc.on("error", (err) => {
    run.status = "failed";
    run.error = err.message;
    run.finishedAt = Date.now();
    run.updatedAt = run.finishedAt;
    run.lastEvent = "spawn_error";
    persistRun(api, run);
  });

  return summarizeRun(run);
}

function getRun(api, runId) {
  ensureStateLoaded(api);
  if (typeof runId !== "string" || !runId.trim()) {
    throw new Error("runId is required");
  }
  const run = RUNS.get(runId.trim());
  if (!run) {
    throw new Error(`run not found: ${runId}`);
  }
  return run;
}

function getStatus(api) {
  ensureStateLoaded(api);
  const runtime = resolveRuntimeConfig(api);
  const activeRuns = Array.from(RUNS.values()).filter((run) => run.status === "running").length;
  return [
    getStatusText({
      wrapper: `${runtime.wrapper} ${fs.existsSync(runtime.wrapper) ? "OK" : "MISSING"}`,
      binary: runtime.binary,
      configPath: "",
      timeoutSeconds: runtime.timeout,
      stateDir: runtime.stateDir,
      label: "FreeClaude plugin status",
    }),
    `defaultModel: ${runtime.defaultModel || "(config default)"}`,
    `activeRuns: ${activeRuns}`,
    `storedRuns: ${RUNS.size}`,
    `storedSessions: ${SESSIONS.size}`,
  ].join("\n");
}

function formatRunState(run) {
  const state = summarizeRun(run);
  const lines = [
    `Run ${state.runId}`,
    `Status: ${state.status}`,
    `Mode: ${state.mode}`,
    `Workdir: ${state.workdir}`,
    `Timeout: ${state.timeout}s`,
  ];

  if (state.sessionKey) lines.push(`Session key: ${state.sessionKey}`);
  if (state.freeClaudeSessionId) lines.push(`FreeClaude session: ${state.freeClaudeSessionId}`);
  if (state.resumeSessionId && state.resumeSessionId !== state.freeClaudeSessionId) {
    lines.push(`Resumed from: ${state.resumeSessionId}`);
  }
  if (state.parentRunId) lines.push(`Parent run: ${state.parentRunId}`);
  if (state.lastEvent) lines.push(`Last event: ${state.lastEvent}`);
  if (state.summary) lines.push(`Summary: ${state.summary}`);
  if (state.partialOutput) lines.push(`Preview:\n${state.partialOutput}`);
  if (state.error) lines.push(`Error: ${state.error}`);

  return lines.join("\n");
}

function parseCommandArgs(raw) {
  const source = (raw || "").trim();
  const result = {
    action: "run",
    task: "",
    runId: "",
    workdir: "",
    model: "",
    timeout: undefined,
    mode: undefined,
    includeMemory: true,
    sessionKey: "",
    resume: true,
    resumeSessionId: "",
    forkSession: false,
    limit: undefined,
    status: "",
    query: "",
  };

  const tokens = source.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const positional = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const unquote = (value) =>
      value.startsWith('"') || value.startsWith("'") ? value.slice(1, -1) : value;

    if (token === "--workdir" && tokens[i + 1]) {
      result.workdir = unquote(tokens[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--model" && tokens[i + 1]) {
      result.model = unquote(tokens[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--timeout" && tokens[i + 1]) {
      const parsed = Number.parseInt(unquote(tokens[i + 1]), 10);
      if (Number.isFinite(parsed)) {
        result.timeout = parsed;
      }
      i += 1;
      continue;
    }
    if (token === "--limit" && tokens[i + 1]) {
      const parsed = Number.parseInt(unquote(tokens[i + 1]), 10);
      if (Number.isFinite(parsed)) {
        result.limit = parsed;
      }
      i += 1;
      continue;
    }
    if (token === "--mode" && tokens[i + 1]) {
      result.mode = unquote(tokens[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--status" && tokens[i + 1]) {
      result.status = unquote(tokens[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--query" && tokens[i + 1]) {
      result.query = unquote(tokens[i + 1]);
      i += 1;
      continue;
    }
    if ((token === "--session" || token === "--session-key") && tokens[i + 1]) {
      result.sessionKey = unquote(tokens[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--resume") {
      if (tokens[i + 1] && !tokens[i + 1].startsWith("--")) {
        result.resumeSessionId = unquote(tokens[i + 1]);
        i += 1;
      }
      result.resume = true;
      continue;
    }
    if (token === "--no-resume" || token === "--fresh") {
      result.resume = false;
      result.resumeSessionId = "";
      continue;
    }
    if (token === "--fork-session") {
      result.forkSession = true;
      continue;
    }
    if (token === "--no-memory") {
      result.includeMemory = false;
      continue;
    }
    positional.push(unquote(token));
  }

  const first = positional[0];
  if (!first) {
    return result;
  }

  if (["help", "status", "runs", "sessions"].includes(first)) {
    result.action = first;
    if (["runs", "sessions"].includes(first)) {
      result.query = result.query || positional.slice(1).join(" ").trim();
    }
    return result;
  }

  if (["start", "poll", "result", "cancel", "retry"].includes(first)) {
    result.action = first;
    if (first === "start") {
      result.task = positional.slice(1).join(" ").trim();
    } else if (first === "retry") {
      result.runId = positional[1] || "";
    } else {
      result.runId = positional[1] || "";
    }
    return result;
  }

  result.task = positional.join(" ").trim();
  return result;
}

const runToolParameters = {
  type: "object",
  properties: {
    task: { type: "string", description: "Detailed coding request for FreeClaude." },
    workdir: { type: "string", description: "Project directory to run in." },
    model: { type: "string", description: "Optional model override." },
    timeout: { type: "number", description: "Timeout in seconds." },
    mode: {
      type: "string",
      enum: ["code", "review", "debug", "explain", "test", "refactor"],
      description: "Task mode.",
    },
    includeMemory: {
      type: "boolean",
      description: "Whether to inject OpenClaw memory context before running.",
    },
    sessionKey: {
      type: "string",
      description: "Stable OpenClaw session key used to bind this task to a resumable FreeClaude session.",
    },
    resume: {
      type: "boolean",
      description: "When false, force a fresh FreeClaude session even if sessionKey already has a saved mapping.",
    },
    resumeSessionId: {
      type: "string",
      description: "Explicit FreeClaude session ID to resume.",
    },
    forkSession: {
      type: "boolean",
      description: "When resuming, fork the saved FreeClaude session instead of reusing the same session ID.",
    },
    retryRunId: {
      type: "string",
      description: "Retry a previously stored run by runId. Reuses its task/workdir/mode/session settings unless overridden.",
    },
    background: {
      type: "boolean",
      description: "When true, start a background run and return a runId instead of waiting for the final result.",
    },
  },
  required: ["task"],
};

const runIdParameters = {
  type: "object",
  properties: {
    runId: { type: "string", description: "Background run ID." },
  },
  required: ["runId"],
};

const listParameters = {
  type: "object",
  properties: {
    limit: {
      type: "number",
      description: `Maximum number of items to return (default: ${DEFAULT_LIST_LIMIT}).`,
    },
    status: {
      type: "string",
      description: "Optional exact status filter (e.g. running, completed, failed, cancelled).",
    },
    mode: {
      type: "string",
      description: "Optional exact mode filter (code, review, debug, explain, test, refactor).",
    },
    sessionKey: {
      type: "string",
      description: "Optional session key or FreeClaude session ID substring filter.",
    },
    workdir: {
      type: "string",
      description: "Optional workdir substring filter.",
    },
    query: {
      type: "string",
      description: "Optional free-text filter over summaries, tasks, workdirs, and session identifiers.",
    },
  },
};

export default function register(api) {
  ensureStateLoaded(api);

  api.registerCommand({
    name: "fc",
    description:
      "Run or manage FreeClaude coding jobs. Examples: /fc --session team-chat fix build | /fc start --workdir ~/project refactor auth | /fc retry <runId>",
    acceptsArgs: true,
    handler: async (ctx) => {
      const parsed = parseCommandArgs(ctx.args || "");

      if (parsed.action === "help" || (!parsed.task && parsed.action === "run")) {
        return {
          text: [
            "Usage:",
            "/fc status",
            "/fc runs [--limit N] [--status STATUS] [--mode MODE] [--session KEY] [--workdir PATH] [--query TEXT]",
            "/fc sessions [--limit N] [--status STATUS] [--mode MODE] [--session KEY] [--workdir PATH] [--query TEXT]",
            "/fc [--session KEY] [--workdir PATH] [--model MODEL] [--timeout SECONDS] [--mode code|review|debug|explain|test|refactor] [--no-memory] [--fresh] [--resume SESSION_ID] [--fork-session] task",
            "/fc start [same flags] task",
            "/fc poll <runId>",
            "/fc result <runId>",
            "/fc cancel <runId>",
            "/fc retry <runId>",
          ].join("\n"),
        };
      }

      try {
        if (parsed.action === "status") {
          return { text: getStatus(api) };
        }
        if (parsed.action === "runs") {
          const items = listRunSummaries(RUNS.values(), parsed);
          return {
            text: formatRunSummaryList(items, { filters: parsed }),
          };
        }
        if (parsed.action === "sessions") {
          const items = listSessionSummaries(SESSIONS.values(), parsed);
          return {
            text: formatSessionSummaryList(items, { filters: parsed }),
          };
        }
        if (parsed.action === "start") {
          if (!parsed.task) {
            return { text: "FreeClaude start requires a task." };
          }
          const run = startFreeClaudeRun(api, parsed, ctx);
          return { text: `Started FreeClaude run ${run.runId}\n${formatRunState(getRun(api, run.runId))}` };
        }
        if (parsed.action === "poll") {
          return { text: formatRunState(getRun(api, parsed.runId)) };
        }
        if (parsed.action === "result") {
          const run = getRun(api, parsed.runId);
          if (!run.result) {
            return { text: formatRunState(run) };
          }
          return { text: toDisplayText(run.result) };
        }
        if (parsed.action === "cancel") {
          const cancelled = cancelRun(api, getRun(api, parsed.runId));
          return { text: formatRunState(getRun(api, cancelled.runId)) };
        }
        if (parsed.action === "retry") {
          if (!parsed.runId) {
            return { text: "FreeClaude retry requires a runId." };
          }
          const run = startFreeClaudeRun(api, { retryRunId: parsed.runId }, ctx);
          return { text: `Started FreeClaude retry ${run.runId}\n${formatRunState(getRun(api, run.runId))}` };
        }

        const result = await runFreeClaude(api, parsed, ctx);
        return { text: toDisplayText(result) };
      } catch (err) {
        return { text: `FreeClaude failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  api.registerGatewayMethod("freeclaude.run", async ({ params, respond }) => {
    try {
      const result = await runFreeClaude(api, params || {});
      respond(true, result);
    } catch (err) {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  api.registerGatewayMethod("freeclaude.start", async ({ params, respond }) => {
    try {
      const run = startFreeClaudeRun(api, params || {});
      respond(true, run);
    } catch (err) {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  api.registerGatewayMethod("freeclaude.poll", async ({ params, respond }) => {
    try {
      respond(true, summarizeRun(getRun(api, params?.runId)));
    } catch (err) {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  api.registerGatewayMethod("freeclaude.result", async ({ params, respond }) => {
    try {
      const run = getRun(api, params?.runId);
      respond(true, run.result ?? summarizeRun(run));
    } catch (err) {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  api.registerGatewayMethod("freeclaude.cancel", async ({ params, respond }) => {
    try {
      respond(true, cancelRun(api, getRun(api, params?.runId)));
    } catch (err) {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  api.registerGatewayMethod("freeclaude.retry", async ({ params, respond }) => {
    try {
      const run = startFreeClaudeRun(api, { ...(params || {}), retryRunId: params?.retryRunId || params?.runId });
      respond(true, run);
    } catch (err) {
      respond(false, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  api.registerGatewayMethod("freeclaude.status", async ({ respond }) => {
    respond(true, {
      text: getStatus(api),
      activeRuns: Array.from(RUNS.values()).filter((run) => run.status === "running").length,
      storedRuns: RUNS.size,
      storedSessions: SESSIONS.size,
    });
  });

  api.registerGatewayMethod("freeclaude.runs", async ({ params, respond }) => {
    const items = listRunSummaries(RUNS.values(), params || {});
    respond(true, {
      text: formatRunSummaryList(items, { filters: params || {} }),
      items,
    });
  });

  api.registerGatewayMethod("freeclaude.sessions", async ({ params, respond }) => {
    const items = listSessionSummaries(SESSIONS.values(), params || {});
    respond(true, {
      text: formatSessionSummaryList(items, { filters: params || {} }),
      items,
    });
  });

  api.registerTool(
    {
      name: "freeclaude_run",
      label: "FreeClaude Run",
      description:
        "Delegate non-trivial coding work to FreeClaude. Use for feature work, debugging, refactors, reviews, tests, and code explanation.",
      parameters: runToolParameters,
      async execute(_toolCallId, params) {
        try {
          if (params?.background === true) {
            const run = startFreeClaudeRun(api, params || {});
            return {
              content: [{ type: "text", text: `Started FreeClaude run ${run.runId}` }],
              details: run,
            };
          }

          const result = await runFreeClaude(api, params || {});
          return {
            content: [{ type: "text", text: toDisplayText(result) }],
            details: result,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `FreeClaude failed: ${message}` }],
            details: { error: message },
          };
        }
      },
    },
    { name: "freeclaude_run" },
  );

  api.registerTool(
    {
      name: "freeclaude_run_status",
      label: "FreeClaude Run Status",
      description: "Poll the status of a background FreeClaude run created with freeclaude_run(background=true).",
      parameters: runIdParameters,
      async execute(_toolCallId, params) {
        try {
          const run = getRun(api, params?.runId);
          return {
            content: [{ type: "text", text: formatRunState(run) }],
            details: summarizeRun(run),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `FreeClaude status failed: ${message}` }],
            details: { error: message },
          };
        }
      },
    },
    { name: "freeclaude_run_status" },
  );

  api.registerTool(
    {
      name: "freeclaude_run_cancel",
      label: "FreeClaude Run Cancel",
      description: "Cancel a running background FreeClaude task.",
      parameters: runIdParameters,
      async execute(_toolCallId, params) {
        try {
          const run = getRun(api, params?.runId);
          const cancelled = cancelRun(api, run);
          return {
            content: [{ type: "text", text: formatRunState(getRun(api, cancelled.runId)) }],
            details: cancelled,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `FreeClaude cancel failed: ${message}` }],
            details: { error: message },
          };
        }
      },
    },
    { name: "freeclaude_run_cancel" },
  );

  api.registerTool(
    {
      name: "freeclaude_run_retry",
      label: "FreeClaude Run Retry",
      description: "Start a new background run by retrying a previously stored FreeClaude run.",
      parameters: {
        type: "object",
        properties: {
          retryRunId: { type: "string", description: "Stored runId to retry." },
          sessionKey: {
            type: "string",
            description: "Optional session key override for the retried run.",
          },
          resumeSessionId: {
            type: "string",
            description: "Optional explicit FreeClaude session ID override.",
          },
          forkSession: {
            type: "boolean",
            description: "Fork the resumed FreeClaude session instead of continuing it.",
          },
        },
        required: ["retryRunId"],
      },
      async execute(_toolCallId, params) {
        try {
          const run = startFreeClaudeRun(api, { ...(params || {}), retryRunId: params?.retryRunId });
          return {
            content: [{ type: "text", text: `Started FreeClaude retry ${run.runId}` }],
            details: run,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `FreeClaude retry failed: ${message}` }],
            details: { error: message },
          };
        }
      },
    },
    { name: "freeclaude_run_retry" },
  );

  api.registerTool(
    {
      name: "freeclaude_status",
      label: "FreeClaude Status",
      description: "Check whether the FreeClaude integration runtime is configured and reachable.",
      parameters: { type: "object", properties: {} },
      async execute() {
        const text = getStatus(api);
        return {
          content: [{ type: "text", text }],
          details: {
            text,
            activeRuns: Array.from(RUNS.values()).filter((run) => run.status === "running").length,
            storedRuns: RUNS.size,
            storedSessions: SESSIONS.size,
          },
        };
      },
    },
    { name: "freeclaude_status" },
  );

  api.registerTool(
    {
      name: "freeclaude_run_list",
      label: "FreeClaude Run List",
      description: "List recent stored FreeClaude runs for inspection and follow-up.",
      parameters: listParameters,
      async execute(_toolCallId, params) {
        const items = listRunSummaries(RUNS.values(), params || {});
        return {
          content: [{ type: "text", text: formatRunSummaryList(items, { filters: params || {} }) }],
          details: { items },
        };
      },
    },
    { name: "freeclaude_run_list" },
  );

  api.registerTool(
    {
      name: "freeclaude_session_list",
      label: "FreeClaude Session List",
      description: "List stored OpenClaw session bindings to FreeClaude sessions.",
      parameters: listParameters,
      async execute(_toolCallId, params) {
        const items = listSessionSummaries(SESSIONS.values(), params || {});
        return {
          content: [{ type: "text", text: formatSessionSummaryList(items, { filters: params || {} }) }],
          details: { items },
        };
      },
    },
    { name: "freeclaude_session_list" },
  );

  api.registerService({
    id: "freeclaude-runtime",
    start: async () => {
      const runtime = resolveRuntimeConfig(api);
      ensureStateLoaded(api);
      api.logger.info(
        `[freeclaude] wrapper=${runtime.wrapper} stateDir=${runtime.stateDir} storedRuns=${RUNS.size} storedSessions=${SESSIONS.size}`,
      );
      return {
        stop() {},
      };
    },
  });
}
