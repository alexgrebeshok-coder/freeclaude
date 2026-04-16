import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { loadPersistedSessions, savePersistedSessions } from "./runtime-state.mjs";

export function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function buildTask(mode, task) {
  const prefixMap = {
    code: "",
    review: "Code review: ",
    debug: "Debug and fix: ",
    explain: "Explain: ",
    test: "Generate tests: ",
    refactor: "Refactor: ",
  };
  return `${prefixMap[mode] || ""}${task}`.trim();
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function parseWrapperEnvelope(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parseJsonLine(lines[i]);
    if (parsed && parsed.type === "wrapper_result") {
      return parsed;
    }
  }

  throw new Error("Wrapper did not return a wrapper_result envelope");
}

export function resolveResumeSessionId({ stateDir, sessionKey, resume, resumeSessionId }) {
  const explicit = readString(resumeSessionId || resume);
  if (explicit) {
    return explicit;
  }
  if (resume === false || !readString(sessionKey)) {
    return "";
  }
  return readString(loadPersistedSessions(stateDir).get(readString(sessionKey))?.freeClaudeSessionId);
}

export function persistSessionBinding({
  stateDir,
  sessionKey,
  workdir,
  model,
  mode,
  envelope,
  lastRunId,
  lastStatus,
}) {
  const resolvedSessionKey = readString(sessionKey);
  const resolvedSessionId = readString(envelope?.sessionId);
  if (!resolvedSessionKey || !resolvedSessionId) {
    return;
  }

  const sessions = loadPersistedSessions(stateDir);
  sessions.set(resolvedSessionKey, {
    sessionKey: resolvedSessionKey,
    freeClaudeSessionId: resolvedSessionId,
    workdir: readString(workdir),
    model: readString(envelope?.model || model),
    mode: readString(mode || "code"),
    lastRunId: readString(lastRunId),
    lastStatus: readString(lastStatus || envelope?.status),
    summary: readString(envelope?.summary),
    updatedAt: Date.now(),
  });
  savePersistedSessions(stateDir, sessions);
}

export class WrappedRunError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "WrappedRunError";
    this.code = details.code ?? null;
    this.stdout = details.stdout ?? "";
    this.stderr = details.stderr ?? "";
    this.envelope = details.envelope ?? null;
  }
}

export async function runWrappedSync({
  wrapper,
  binary,
  stateDir,
  workdir,
  task,
  mode = "code",
  model,
  timeoutSeconds = 120,
  includeMemory = true,
  sessionKey,
  resumeSessionId,
  forkSession = false,
  persistBinding = true,
  lastRunId,
  cwd,
}) {
  if (!existsSync(wrapper)) {
    throw new WrappedRunError(`FreeClaude wrapper not found: ${wrapper}`);
  }

  const args = ["--timeout", String(timeoutSeconds), "--output-format", "json"];
  if (workdir) {
    args.push("--workdir", workdir);
  }
  if (model) {
    args.push("--model", model);
  }
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  if (forkSession === true) {
    args.push("--fork-session");
  }
  args.push(buildTask(mode, task));

  const envelope = await new Promise((resolve, reject) => {
    const proc = spawn(wrapper, args, {
      cwd: cwd || workdir || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        FC_BINARY: binary,
        FC_MEMORY_BRIDGE: includeMemory ? "1" : "0",
        FC_STATE_DIR: stateDir,
        FC_PERSIST_RUN_STATE: "0",
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      let parsedEnvelope;
      try {
        parsedEnvelope = parseWrapperEnvelope(stdout);
      } catch (err) {
        reject(
          new WrappedRunError((stderr || stdout || err.message || `FreeClaude exited with code ${code}`).trim(), {
            code,
            stdout,
            stderr,
          }),
        );
        return;
      }

      if (code !== 0 || parsedEnvelope.status !== "success") {
        reject(
          new WrappedRunError(
            (parsedEnvelope.error || stderr || stdout || `FreeClaude exited with code ${code}`).trim(),
            {
              code,
              stdout,
              stderr,
              envelope: parsedEnvelope,
            },
          ),
        );
        return;
      }

      resolve(parsedEnvelope);
    });

    proc.on("error", (err) => {
      reject(new WrappedRunError(err.message));
    });
  });

  if (persistBinding) {
    persistSessionBinding({
      stateDir,
      sessionKey,
      workdir,
      model,
      mode,
      envelope,
      lastRunId,
      lastStatus: envelope.status,
    });
  }

  return { ...envelope, sessionKey: readString(sessionKey) || undefined };
}

export function getStatusText({ wrapper, binary, configPath, timeoutSeconds, stateDir, label = "FreeClaude Status" }) {
  const storedSessions = loadPersistedSessions(stateDir).size;
  const configLine = configPath ? `Config: ${configPath}` : "Config: (not configured)";

  try {
    if (configPath && existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const providers = (config.providers || [])
        .map((provider, index) => `${index + 1}. ${provider.name} — ${provider.model} (priority: ${provider.priority || 999})`)
        .join("\n");
      return (
        `${label}\n` +
        `Wrapper: ${wrapper}\n` +
        `Binary: ${binary}\n` +
        `${configLine}\n` +
        `Timeout: ${timeoutSeconds}s\n` +
        `StateDir: ${stateDir}\n` +
        `Stored Sessions: ${storedSessions}\n\n` +
        `Providers:\n${providers}`
      );
    }

    return (
      `${label}\n` +
      `Wrapper: ${wrapper}\n` +
      `Binary: ${binary}\n` +
      `StateDir: ${stateDir}\n` +
      `Stored Sessions: ${storedSessions}\n` +
      (configPath ? `Config: not found (${configPath})` : configLine)
    );
  } catch (error) {
    return `${label}\nError reading config: ${error.message}`;
  }
}
