import { loadPersistedRuns, loadPersistedSessions, serializeRun } from "./runtime-state.mjs";

export const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 25;

function clampLimit(limit, fallback = DEFAULT_LIST_LIMIT) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.floor(limit)));
}

function compactText(value, maxLength = 140) {
  if (typeof value !== "string") return "";
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function formatTimestamp(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  return new Date(value).toISOString().replace(".000Z", "Z");
}

function shortId(value) {
  if (typeof value !== "string") return "";
  return value.length <= 8 ? value : value.slice(0, 8);
}

function normalizedFilter(value) {
  return normalizeText(value).toLowerCase();
}

function includesFilter(candidate, filterValue) {
  const normalizedCandidate = normalizedFilter(candidate);
  if (!filterValue) return true;
  return normalizedCandidate.includes(filterValue);
}

function equalsFilter(candidate, filterValue) {
  if (!filterValue) return true;
  return normalizedFilter(candidate) === filterValue;
}

function buildFilterLabel(options = {}) {
  const parts = [];
  const status = normalizedFilter(options.status);
  const mode = normalizedFilter(options.mode);
  const sessionKey = normalizeText(options.sessionKey);
  const workdir = normalizeText(options.workdir);
  const query = normalizeText(options.query);

  if (status) parts.push(`status=${status}`);
  if (mode) parts.push(`mode=${mode}`);
  if (sessionKey) parts.push(`session=${sessionKey}`);
  if (workdir) parts.push(`workdir~${workdir}`);
  if (query) parts.push(`query~${query}`);
  return parts.join(", ");
}

function matchesRunFilters(item, options = {}) {
  const status = normalizedFilter(options.status);
  const mode = normalizedFilter(options.mode);
  const sessionKey = normalizedFilter(options.sessionKey);
  const workdir = normalizedFilter(options.workdir);
  const query = normalizedFilter(options.query);

  if (!equalsFilter(item.status, status)) return false;
  if (!equalsFilter(item.mode, mode)) return false;
  if (!includesFilter(item.sessionKey, sessionKey) && !includesFilter(item.freeClaudeSessionId, sessionKey)) return false;
  if (!includesFilter(item.workdir, workdir)) return false;
  if (
    query &&
    ![
      item.runId,
      item.shortRunId,
      item.task,
      item.summary,
      item.workdir,
      item.sessionKey,
      item.freeClaudeSessionId,
      item.parentRunId,
      item.model,
    ].some((candidate) => includesFilter(candidate, query))
  ) {
    return false;
  }
  return true;
}

function matchesSessionFilters(item, options = {}) {
  const status = normalizedFilter(options.status);
  const mode = normalizedFilter(options.mode);
  const sessionKey = normalizedFilter(options.sessionKey);
  const workdir = normalizedFilter(options.workdir);
  const query = normalizedFilter(options.query);

  if (!equalsFilter(item.lastStatus, status)) return false;
  if (!equalsFilter(item.mode, mode)) return false;
  if (!includesFilter(item.sessionKey, sessionKey) && !includesFilter(item.freeClaudeSessionId, sessionKey)) return false;
  if (!includesFilter(item.workdir, workdir)) return false;
  if (
    query &&
    ![
      item.sessionKey,
      item.freeClaudeSessionId,
      item.summary,
      item.workdir,
      item.model,
      item.lastRunId,
      item.lastStatus,
    ].some((candidate) => includesFilter(candidate, query))
  ) {
    return false;
  }
  return true;
}

function summarizeSession(entry) {
  const sessionKey = typeof entry?.sessionKey === "string" ? entry.sessionKey.trim() : "";
  const freeClaudeSessionId =
    typeof entry?.freeClaudeSessionId === "string" ? entry.freeClaudeSessionId.trim() : "";
  const workdir = typeof entry?.workdir === "string" ? entry.workdir.trim() : "";
  const model = typeof entry?.model === "string" ? entry.model.trim() : "";
  const mode = typeof entry?.mode === "string" ? entry.mode.trim() : "";
  const lastRunId = typeof entry?.lastRunId === "string" ? entry.lastRunId.trim() : "";
  const lastStatus = typeof entry?.lastStatus === "string" ? entry.lastStatus.trim() : "";
  const summary = compactText(entry?.summary, 160);
  const updatedAt = typeof entry?.updatedAt === "number" && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0;

  return {
    sessionKey,
    freeClaudeSessionId,
    workdir,
    model,
    mode,
    lastRunId,
    lastStatus,
    summary,
    updatedAt,
    updatedAtText: formatTimestamp(updatedAt),
    lastRunShortId: shortId(lastRunId),
  };
}

export function summarizeRunForInspection(run) {
  const normalized = serializeRun(run);
  const summary = compactText(normalized.summary || normalized.partialOutput || normalized.task, 160);
  return {
    runId: normalized.runId,
    shortRunId: shortId(normalized.runId),
    status: normalized.status,
    task: compactText(normalized.task, 160),
    mode: normalized.mode,
    workdir: normalized.workdir,
    model: normalized.model,
    timeout: normalized.timeout,
    sessionKey: normalized.sessionKey,
    freeClaudeSessionId: normalized.freeClaudeSessionId || normalized.result?.sessionId || "",
    parentRunId: normalized.parentRunId,
    summary,
    updatedAt: normalized.updatedAt,
    updatedAtText: formatTimestamp(normalized.updatedAt),
    startedAt: normalized.startedAt,
    startedAtText: formatTimestamp(normalized.startedAt),
    finishedAt: normalized.finishedAt,
    finishedAtText: formatTimestamp(normalized.finishedAt),
    exitCode: normalized.exitCode,
    hasResult: Boolean(normalized.result),
  };
}

export function listRunSummaries(runs, options = {}) {
  const limit = clampLimit(options.limit);
  return Array.from(runs || [])
    .map((run) => summarizeRunForInspection(run))
    .filter((run) => matchesRunFilters(run, options))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

export function listSessionSummaries(sessions, options = {}) {
  const limit = clampLimit(options.limit);
  return Array.from(sessions || [])
    .map((entry) => summarizeSession(entry))
    .filter((session) => session.sessionKey && session.freeClaudeSessionId)
    .filter((session) => matchesSessionFilters(session, options))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

export function readPersistedRunSummaries(stateDir, options = {}) {
  return listRunSummaries(loadPersistedRuns(stateDir).values(), options);
}

export function readPersistedSessionSummaries(stateDir, options = {}) {
  return listSessionSummaries(loadPersistedSessions(stateDir).values(), options);
}

export function formatRunSummaryList(items, { title = "Recent FreeClaude runs", filters = {} } = {}) {
  const label = buildFilterLabel(filters);
  const heading = label ? `${title} (${label})` : title;
  if (!Array.isArray(items) || items.length === 0) {
    return `${heading}\n${label ? "(no matching runs)" : "(no stored runs)"}`;
  }

  return [
    heading,
    ...items.map((item) => {
      const lines = [`- ${item.shortRunId} [${item.status}] ${item.mode} @ ${item.updatedAtText || "unknown time"}`];
      if (item.workdir) lines.push(`  workdir: ${item.workdir}`);
      if (item.sessionKey || item.freeClaudeSessionId) {
        lines.push(
          `  session: ${item.sessionKey || "(none)"}${item.freeClaudeSessionId ? ` -> ${item.freeClaudeSessionId}` : ""}`,
        );
      }
      if (item.parentRunId) lines.push(`  parent: ${shortId(item.parentRunId)}`);
      if (item.summary) lines.push(`  summary: ${item.summary}`);
      else if (item.task) lines.push(`  task: ${item.task}`);
      return lines.join("\n");
    }),
  ].join("\n");
}

export function formatSessionSummaryList(items, { title = "Stored FreeClaude sessions", filters = {} } = {}) {
  const label = buildFilterLabel(filters);
  const heading = label ? `${title} (${label})` : title;
  if (!Array.isArray(items) || items.length === 0) {
    return `${heading}\n${label ? "(no matching sessions)" : "(no stored sessions)"}`;
  }

  return [
    heading,
    ...items.map((item) => {
      const lines = [
        `- ${item.sessionKey} -> ${item.freeClaudeSessionId} @ ${item.updatedAtText || "unknown time"}`,
      ];
      if (item.lastStatus || item.mode) {
        lines.push(
          `  status: ${item.lastStatus || "unknown"}${item.mode ? ` | mode: ${item.mode}` : ""}${
            item.model ? ` | model: ${item.model}` : ""
          }`,
        );
      }
      if (item.lastRunId) lines.push(`  last run: ${item.lastRunShortId}`);
      if (item.workdir) lines.push(`  workdir: ${item.workdir}`);
      if (item.summary) lines.push(`  summary: ${item.summary}`);
      return lines.join("\n");
    }),
  ].join("\n");
}
