function compactText(value, maxLength = 4000) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJsonOutput(output) {
  if (typeof output !== "string") return null;
  const trimmed = output.trim();
  if (!trimmed || !/^[{\[]/.test(trimmed)) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractMentionedPaths(text, limit = 12) {
  if (typeof text !== "string" || !text.trim()) {
    return [];
  }

  const matches = text.match(
    /(?:\.\.?\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?:\.[A-Za-z0-9._-]+)?/g,
  ) ?? [];
  const seen = new Set();
  const paths = [];

  for (const raw of matches) {
    const candidate = raw.replace(/[),.:;!?]+$/, "");
    if (
      !candidate ||
      candidate.includes("://") ||
      candidate.length > 240 ||
      seen.has(candidate)
    ) {
      continue;
    }
    seen.add(candidate);
    paths.push(candidate);
    if (paths.length >= limit) {
      break;
    }
  }

  return paths;
}

function deriveState(status) {
  switch (status) {
    case "success":
    case "completed":
      return "completed";
    case "timeout":
      return "failed";
    case "error":
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "interrupted":
      return "interrupted";
    case "running":
      return "running";
    default:
      return "unknown";
  }
}

function deriveOutcome(status) {
  switch (status) {
    case "success":
    case "completed":
      return "success";
    case "timeout":
      return "timeout";
    case "cancelled":
      return "cancelled";
    case "running":
      return "in_progress";
    case "interrupted":
      return "interrupted";
    case "error":
    case "failed":
    default:
      return "error";
  }
}

function deriveFollowUpAction(state, outcome) {
  if (state === "running") return "poll";
  if (state === "cancelled") return "retry";
  if (outcome === "timeout" || outcome === "error" || state === "interrupted") {
    return "inspect_error";
  }
  return "none";
}

export function buildDelegationResult({
  runId,
  parentRunId,
  sessionKey,
  sessionId,
  status,
  mode,
  task,
  summary,
  output,
  partialOutput,
  error,
  workdir,
  requestedModel,
  actualModel,
  durationMs,
  timeoutSec,
  exitCode,
  costUsd,
  usage,
  stopReason,
  startedAt,
  updatedAt,
  finishedAt,
} = {}) {
  const normalizedStatus = typeof status === "string" ? status : "unknown";
  const state = deriveState(normalizedStatus);
  const outcome = deriveOutcome(normalizedStatus);
  const outputText = compactText(output || partialOutput || "");
  const errorText = compactText(error || "", 2000);
  const summaryText = compactText(summary || outputText || errorText, 600);
  const parsedJson = parseJsonOutput(outputText);

  return {
    schemaVersion: 1,
    kind: "freeclaude.delegation",
    runId: runId || undefined,
    parentRunId: parentRunId || undefined,
    sessionKey: sessionKey || undefined,
    sessionId: sessionId || undefined,
    mode: mode || "code",
    state,
    outcome,
    followUpAction: deriveFollowUpAction(state, outcome),
    needsFollowUp: deriveFollowUpAction(state, outcome) !== "none",
    task: {
      prompt: compactText(task || "", 4000),
      summary: summaryText,
    },
    execution: {
      workdir: workdir || undefined,
      requestedModel: requestedModel || undefined,
      actualModel: actualModel || requestedModel || undefined,
      durationMs: safeNumber(durationMs),
      timeoutSec: safeNumber(timeoutSec),
      exitCode: safeNumber(exitCode),
      costUsd: safeNumber(costUsd),
      usage: usage && typeof usage === "object" ? usage : null,
      stopReason: stopReason || undefined,
      startedAt: safeNumber(startedAt),
      updatedAt: safeNumber(updatedAt),
      finishedAt: safeNumber(finishedAt),
    },
    output: {
      text: outputText || undefined,
      parsedJson,
      mentionedPaths: extractMentionedPaths(outputText),
    },
    error: errorText
      ? {
          message: errorText,
        }
      : null,
  };
}

export function attachDelegationResult(payload, context = {}) {
  const delegation = buildDelegationResult({
    runId: context.runId,
    parentRunId: context.parentRunId,
    sessionKey: context.sessionKey,
    sessionId: payload?.sessionId || context.sessionId,
    status: payload?.status ?? context.status,
    mode: context.mode,
    task: context.task,
    summary: payload?.summary ?? context.summary,
    output: payload?.output,
    partialOutput: context.partialOutput,
    error: payload?.error ?? context.error,
    workdir: payload?.workdir ?? context.workdir,
    requestedModel: payload?.requestedModel ?? context.model,
    actualModel: payload?.actualModel ?? payload?.model ?? context.model,
    durationMs: payload?.durationMs,
    timeoutSec: payload?.timeoutSec,
    exitCode: payload?.exitCode,
    costUsd: payload?.costUsd,
    usage: payload?.usage,
    stopReason: payload?.stopReason,
    startedAt: context.startedAt,
    updatedAt: context.updatedAt,
    finishedAt: context.finishedAt,
  });

  return {
    ...payload,
    delegation,
  };
}
