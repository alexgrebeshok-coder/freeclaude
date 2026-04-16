import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const MAX_PERSISTED_RUNS = 50;
export const DEFAULT_STATE_DIR = path.join(
  homedir(),
  ".openclaw",
  "workspace",
  ".openclaw",
  "extensions",
  "freeclaude",
  "state",
);

function ensureStateDir(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  return stateDir;
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, payload) {
  ensureStateDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function sanitizeString(value, maxLength = 1000) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, maxLength);
}

function sanitizeTimestamp(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

export function serializeRun(run) {
  return {
    runId: sanitizeString(run?.runId, 200),
    status: sanitizeString(run?.status, 64) || "failed",
    task: sanitizeString(run?.task, 4000),
    mode: sanitizeString(run?.mode, 64) || "code",
    workdir: sanitizeString(run?.workdir, 4000),
    model: sanitizeString(run?.model, 200),
    timeout: typeof run?.timeout === "number" && Number.isFinite(run.timeout) ? run.timeout : 120,
    includeMemory: run?.includeMemory !== false,
    sessionKey: sanitizeString(run?.sessionKey, 300),
    resumeSessionId: sanitizeString(run?.resumeSessionId, 200),
    freeClaudeSessionId: sanitizeString(run?.freeClaudeSessionId, 200),
    forkSession: run?.forkSession === true,
    parentRunId: sanitizeString(run?.parentRunId, 200),
    summary: sanitizeString(run?.summary, 4000),
    partialOutput: typeof run?.partialOutput === "string" ? run.partialOutput.slice(-4000) : "",
    lastEvent: sanitizeString(run?.lastEvent, 200),
    startedAt: sanitizeTimestamp(run?.startedAt),
    updatedAt: sanitizeTimestamp(run?.updatedAt),
    finishedAt:
      typeof run?.finishedAt === "number" && Number.isFinite(run.finishedAt) ? run.finishedAt : null,
    error: sanitizeString(run?.error, 4000) || null,
    exitCode: typeof run?.exitCode === "number" && Number.isFinite(run.exitCode) ? run.exitCode : null,
    result:
      run?.result && typeof run.result === "object" && !Array.isArray(run.result) ? run.result : null,
  };
}

function recoverRun(entry) {
  const run = serializeRun(entry);
  if (run.status === "running") {
    run.status = "interrupted";
    run.finishedAt = run.finishedAt ?? Date.now();
    run.updatedAt = Date.now();
    run.lastEvent = "runtime_recovered";
    run.error = run.error || "Runtime restarted while this run was active.";
  }
  return run;
}

export function loadPersistedRuns(stateDir = DEFAULT_STATE_DIR) {
  const payload = readJsonFile(path.join(ensureStateDir(stateDir), "runs.json"), { runs: [] });
  const runs = new Map();
  const list = Array.isArray(payload?.runs) ? payload.runs : [];

  for (const entry of list) {
    const run = recoverRun(entry);
    if (run.runId) {
      runs.set(run.runId, run);
    }
  }

  return runs;
}

export function savePersistedRuns(stateDir = DEFAULT_STATE_DIR, runs) {
  const entries = Array.from(runs.values())
    .map((run) => serializeRun(run))
    .filter((run) => run.runId)
    .sort((a, b) => a.startedAt - b.startedAt);

  while (entries.length > MAX_PERSISTED_RUNS) {
    entries.shift();
  }

  writeJsonFile(path.join(ensureStateDir(stateDir), "runs.json"), {
    version: 1,
    updatedAt: Date.now(),
    runs: entries,
  });
}

function serializeSession(entry) {
  return {
    sessionKey: sanitizeString(entry?.sessionKey, 300),
    freeClaudeSessionId: sanitizeString(entry?.freeClaudeSessionId, 200),
    workdir: sanitizeString(entry?.workdir, 4000),
    model: sanitizeString(entry?.model, 200),
    mode: sanitizeString(entry?.mode, 64),
    lastRunId: sanitizeString(entry?.lastRunId, 200),
    lastStatus: sanitizeString(entry?.lastStatus, 64),
    summary: sanitizeString(entry?.summary, 1000),
    updatedAt: sanitizeTimestamp(entry?.updatedAt),
  };
}

export function loadPersistedSessions(stateDir = DEFAULT_STATE_DIR) {
  const payload = readJsonFile(path.join(ensureStateDir(stateDir), "sessions.json"), { sessions: [] });
  const sessions = new Map();
  const list = Array.isArray(payload?.sessions) ? payload.sessions : [];

  for (const entry of list) {
    const session = serializeSession(entry);
    if (session.sessionKey && session.freeClaudeSessionId) {
      sessions.set(session.sessionKey, session);
    }
  }

  return sessions;
}

export function savePersistedSessions(stateDir = DEFAULT_STATE_DIR, sessions) {
  const entries = Array.from(sessions.values())
    .map((session) => serializeSession(session))
    .filter((session) => session.sessionKey && session.freeClaudeSessionId)
    .sort((a, b) => a.updatedAt - b.updatedAt);

  writeJsonFile(path.join(ensureStateDir(stateDir), "sessions.json"), {
    version: 1,
    updatedAt: Date.now(),
    sessions: entries,
  });
}
