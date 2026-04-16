#!/usr/bin/env node
/**
 * FreeClaude MCP Server
 * 
 * Exposes FreeClaude as an MCP server over stdio transport.
 * OpenClaw agents can use these tools to delegate coding tasks.
 * 
 * Tools:
 *   - freeclaude_code: Write, edit, or generate code
 *   - freeclaude_review: Review code for bugs and issues
 *   - freeclaude_debug: Debug and fix issues
 *   - freeclaude_explain: Explain code or architecture
 *   - freeclaude_test: Generate tests
 *   - freeclaude_refactor: Refactor code
 * 
 * Resources:
 *   - freeclaude://status — Provider and model status
 */

import { createInterface } from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  DEFAULT_STATE_DIR,
} from "./runtime-state.mjs";
import {
  getStatusText,
  normalizeAdditionalDirs,
  normalizeJsonSchemaOption,
  normalizeStringListOption,
  readPositiveInteger,
  readPositiveNumber,
  readString,
  resolveResumeSessionId,
  runWrappedSync,
} from "./freeclaude-backend.mjs";
import {
  formatRunSummaryList,
  formatSessionSummaryList,
  readPersistedRunSummaries,
  readPersistedSessionSummaries,
} from "./inspection.mjs";

// MCP Protocol constants
const JSONRPC_VERSION = "2.0";
const MCP_PROTOCOL_VERSION = "2024-11-05";

// FreeClaude config
const FC_BINARY = process.env.FREECLAUDE_BINARY || "freeclaude";
const FC_TIMEOUT_SECONDS = parseInt(process.env.FREECLAUDE_TIMEOUT || "120", 10);
const FC_TIMEOUT = FC_TIMEOUT_SECONDS * 1000;
const FC_WRAPPER =
  process.env.FREECLAUDE_WRAPPER ||
  path.join(homedir(), ".openclaw", "workspace", "tools", "freeclaude-run.sh");
const FC_STATE_DIR = process.env.FREECLAUDE_STATE_DIR || DEFAULT_STATE_DIR;
const FC_CONFIG_PATH = path.join(homedir(), ".freeclaude.json");
const OC_MEMORY_TODAY_PATH = path.join(
  homedir(),
  ".openclaw",
  "workspace",
  "memory",
  new Date().toISOString().slice(0, 10) + ".md",
);
const OC_MEMORY_LONGTERM_PATH = path.join(homedir(), ".openclaw", "workspace", "MEMORY.md");

// Tool definitions
const TOOLS = [
  {
    name: "freeclaude_code",
    description: "Write, edit, or generate code using FreeClaude coding agent. Use for creating features, fixing bugs, writing scripts, modifying existing code across multiple files. FreeClaude has LSP integration, git awareness, and 40+ tools.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Detailed description of what code to write/edit. Be specific about files, language, framework, and expected behavior." },
        workdir: { type: "string", description: "Project directory to work in (FreeClaude will have full access)" },
        model: { type: "string", description: "Model to use (optional, defaults to config)" }
      },
      required: ["task"]
    }
  },
  {
    name: "freeclaude_review",
    description: "Review code for bugs, security issues, and improvements. Can review specific files, recent commits, or entire modules.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What to review: specific files, last commit, a module, etc." },
        workdir: { type: "string", description: "Project directory" },
        model: { type: "string", description: "Model to use (optional)" }
      },
      required: ["task"]
    }
  },
  {
    name: "freeclaude_debug",
    description: "Debug and fix issues. Provide error messages, stack traces, or describe the problem. FreeClaude will investigate, find the root cause, and apply fixes.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Description of the bug/error, include stack traces if available" },
        workdir: { type: "string", description: "Project directory" },
        model: { type: "string", description: "Model to use (optional)" }
      },
      required: ["task"]
    }
  },
  {
    name: "freeclaude_explain",
    description: "Explain code, architecture, or technical concepts. FreeClaude reads the codebase and provides detailed explanations.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What to explain: a file, function, module, architecture decision, etc." },
        workdir: { type: "string", description: "Project directory" },
        model: { type: "string", description: "Model to use (optional)" }
      },
      required: ["task"]
    }
  },
  {
    name: "freeclaude_test",
    description: "Generate tests for code. Specify what to test, the testing framework, and coverage expectations.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What to test: specific files, functions, or modules. Include framework preference (Jest, Vitest, pytest, etc.)" },
        workdir: { type: "string", description: "Project directory" },
        model: { type: "string", description: "Model to use (optional)" }
      },
      required: ["task"]
    }
  },
  {
    name: "freeclaude_refactor",
    description: "Refactor code: extract functions, rename, change patterns, restructure modules. Preserves behavior while improving code quality.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What to refactor and how. Be specific about the desired pattern/structure." },
        workdir: { type: "string", description: "Project directory" },
        model: { type: "string", description: "Model to use (optional)" }
      },
      required: ["task"]
    }
  }
];

const COMMON_TOOL_PROPERTIES = {
  timeout: { type: "number", description: "Optional timeout in seconds." },
  includeMemory: {
    type: "boolean",
    description: "Whether to inject OpenClaw memory context before running the task (default: true)."
  },
  permissionMode: {
    type: "string",
    description: "Optional FreeClaude permission mode override (for example: bypassPermissions or plan)."
  },
  bareMode: {
    type: "boolean",
    description: "Override wrapper bare mode. true forces --bare, false forces --no-bare."
  },
  maxTurns: {
    type: "number",
    description: "Optional maximum turn limit for the FreeClaude run."
  },
  effort: {
    type: "string",
    enum: ["low", "medium", "high", "max"],
    description: "Optional reasoning effort level."
  },
  maxBudgetUsd: {
    type: "number",
    description: "Optional budget cap in USD for the run."
  },
  fallbackModel: {
    type: "string",
    description: "Optional model to fall back to if the primary model fails."
  },
  allowedTools: {
    oneOf: [
      { type: "string" },
      { type: "array", items: { type: "string" } }
    ],
    description: "Optional tool allowlist passed through to FreeClaude."
  },
  disallowedTools: {
    oneOf: [
      { type: "string" },
      { type: "array", items: { type: "string" } }
    ],
    description: "Optional tool denylist passed through to FreeClaude."
  },
  tools: {
    oneOf: [
      { type: "string" },
      { type: "array", items: { type: "string" } }
    ],
    description: "Optional exact tool set exposed to FreeClaude."
  },
  systemPrompt: {
    type: "string",
    description: "Optional full system prompt override."
  },
  appendSystemPrompt: {
    type: "string",
    description: "Optional system prompt suffix appended to the default system prompt."
  },
  jsonSchema: {
    oneOf: [
      { type: "string" },
      { type: "object" }
    ],
    description: "Optional JSON schema response contract. Accepts a JSON string or object."
  },
  noPersist: {
    type: "boolean",
    description: "Disable FreeClaude session persistence for this run."
  },
  addDirs: {
    type: "array",
    items: { type: "string" },
    description: "Additional directories FreeClaude may access beyond workdir."
  },
  sessionKey: {
    type: "string",
    description: "Stable OpenClaw session key used to bind this task to a resumable FreeClaude session."
  },
  resume: {
    type: "boolean",
    description: "When false, force a fresh FreeClaude session even if sessionKey already has a saved mapping."
  },
  resumeSessionId: {
    type: "string",
    description: "Explicit FreeClaude session ID to resume."
  },
  forkSession: {
    type: "boolean",
    description: "When resuming, fork the saved FreeClaude session instead of reusing the same session ID."
  }
};

for (const tool of TOOLS) {
  tool.inputSchema.properties = {
    ...tool.inputSchema.properties,
    ...COMMON_TOOL_PROPERTIES
  };
}

// Resource definitions
const RESOURCES = [
  {
    uri: "freeclaude://status",
    name: "FreeClaude Status",
    description: "Current FreeClaude provider configuration and status",
    mimeType: "text/plain"
  },
  {
    uri: "freeclaude://memory/today",
    name: "OpenClaw Memory Today",
    description: "Today's OpenClaw daily memory note used for context injection",
    mimeType: "text/plain"
  },
  {
    uri: "freeclaude://memory/longterm",
    name: "OpenClaw Memory Long-term",
    description: "OpenClaw long-term MEMORY.md used for context injection",
    mimeType: "text/plain"
  },
  {
    uri: "freeclaude://runs",
    name: "FreeClaude Recent Runs",
    description: "Recent persisted FreeClaude runs for inspection and retry workflows",
    mimeType: "text/plain"
  },
  {
    uri: "freeclaude://sessions",
    name: "FreeClaude Sessions",
    description: "Stored OpenClaw session bindings to FreeClaude sessions",
    mimeType: "text/plain"
  }
];

function readOptionalFile(filePath) {
  if (!existsSync(filePath)) {
    return "";
  }
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function resolveUserPath(input) {
  const value = readString(input);
  if (!value) {
    return "";
  }
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

function runFreeClaude({
  task,
  workdir,
  model,
  mode = "code",
  timeout,
  includeMemory = true,
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
  addDirs,
  extraDirs,
  sessionKey,
  resume,
  resumeSessionId,
  forkSession = false,
}) {
  return new Promise((resolve, reject) => {
    const resolvedTimeout =
      typeof timeout === "number" && Number.isFinite(timeout)
        ? Math.max(10, Math.floor(timeout))
        : FC_TIMEOUT_SECONDS;
    const resolvedWorkdir = resolveUserPath(workdir);
    const resolvedResumeSessionId = resolveResumeSessionId({
      stateDir: FC_STATE_DIR,
      sessionKey,
      resume,
      resumeSessionId,
    });
    const resolvedPermissionMode = readString(permissionMode);
    const resolvedBareMode =
      typeof bareMode === "boolean" ? bareMode : undefined;
    const resolvedMaxTurns = readPositiveInteger(maxTurns);
    const effortCandidate = readString(effort).toLowerCase();
    const resolvedEffort =
      ["low", "medium", "high", "max"].includes(effortCandidate) ? effortCandidate : undefined;
    const resolvedMaxBudgetUsd = readPositiveNumber(maxBudgetUsd);
    const resolvedFallbackModel = readString(fallbackModel);
    const resolvedAllowedTools = normalizeStringListOption(allowedTools);
    const resolvedDisallowedTools = normalizeStringListOption(disallowedTools);
    const resolvedTools = normalizeStringListOption(tools);
    const resolvedSystemPrompt = readString(systemPrompt);
    const resolvedAppendSystemPrompt = readString(appendSystemPrompt);
    const resolvedJsonSchema = normalizeJsonSchemaOption(jsonSchema);
    const resolvedExtraDirs = normalizeAdditionalDirs(addDirs || extraDirs, resolveUserPath).filter(
      (dir) => dir !== resolvedWorkdir,
    );

    runWrappedSync({
      wrapper: FC_WRAPPER,
      binary: FC_BINARY,
      stateDir: FC_STATE_DIR,
      workdir: resolvedWorkdir,
      task,
      mode,
      model,
      timeoutSeconds: resolvedTimeout,
      includeMemory,
      permissionMode: resolvedPermissionMode,
      bareMode: resolvedBareMode,
      maxTurns: resolvedMaxTurns,
      effort: resolvedEffort,
      maxBudgetUsd: resolvedMaxBudgetUsd,
      fallbackModel: resolvedFallbackModel,
      allowedTools: resolvedAllowedTools,
      disallowedTools: resolvedDisallowedTools,
      tools: resolvedTools,
      systemPrompt: resolvedSystemPrompt,
      appendSystemPrompt: resolvedAppendSystemPrompt,
      jsonSchema: resolvedJsonSchema,
      noPersist: noPersist === true,
      extraDirs: resolvedExtraDirs,
      sessionKey,
      resumeSessionId: resolvedResumeSessionId,
      forkSession,
      persistBinding: true,
    }).then(resolve, reject);
  });
}

/**
 * Get FreeClaude provider status
 */
function getStatus() {
  return getStatusText({
    wrapper: FC_WRAPPER,
    binary: FC_BINARY,
    configPath: FC_CONFIG_PATH,
    timeoutSeconds: FC_TIMEOUT_SECONDS,
    stateDir: FC_STATE_DIR,
  });
}

// ─── MCP Protocol Implementation ───

const rl = createInterface({ input: process.stdin, terminal: false });

function send(message) {
  const json = JSON.stringify(message);
  process.stdout.write(json + "\n");
}

function sendResult(id, result) {
  send({ jsonrpc: JSONRPC_VERSION, id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: JSONRPC_VERSION, id, error: { code, message } });
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  
  switch (method) {
    case "initialize":
      sendResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: {}
        },
        serverInfo: {
          name: "freeclaude",
          version: "1.0.0"
        }
      });
      break;
      
    case "tools/list":
      sendResult(id, { tools: TOOLS });
      break;
      
    case "tools/call": {
      const toolName = params?.name;
      const args = params?.arguments || {};
      
      const tool = TOOLS.find(t => t.name === toolName);
      if (!tool) {
        sendError(id, -32602, `Unknown tool: ${toolName}`);
        return;
      }
      
      const modeMap = {
        freeclaude_code: "code",
        freeclaude_review: "review",
        freeclaude_debug: "debug",
        freeclaude_explain: "explain",
        freeclaude_test: "test",
        freeclaude_refactor: "refactor"
      };

      try {
        const result = await runFreeClaude({
          task: args.task,
          workdir: args.workdir,
          model: args.model,
          timeout: args.timeout,
          includeMemory: args.includeMemory !== false,
          permissionMode: args.permissionMode,
          bareMode: args.bareMode,
          maxTurns: args.maxTurns,
          effort: args.effort,
          maxBudgetUsd: args.maxBudgetUsd,
          fallbackModel: args.fallbackModel,
          allowedTools: args.allowedTools,
          disallowedTools: args.disallowedTools,
          tools: args.tools,
          systemPrompt: args.systemPrompt,
          appendSystemPrompt: args.appendSystemPrompt,
          jsonSchema: args.jsonSchema,
          noPersist: args.noPersist === true,
          addDirs: args.addDirs,
          sessionKey: args.sessionKey,
          resume: args.resume,
          resumeSessionId: args.resumeSessionId,
          forkSession: args.forkSession === true,
          mode: modeMap[toolName] || "code"
        });
        const text = result.output || result.summary || "FreeClaude completed.";
        sendResult(id, {
          content: [{ type: "text", text }],
          structuredContent: result
        });
      } catch (err) {
        sendResult(id, {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          structuredContent: {
            type: "wrapper_result",
            status: "error",
            summary: `Error: ${err.message}`,
            output: "",
            error: err.message
          },
          isError: true
        });
      }
      break;
    }
    
    case "resources/list":
      sendResult(id, { resources: RESOURCES });
      break;
      
    case "resources/read": {
      const uri = params?.uri;
      if (uri === "freeclaude://status") {
        sendResult(id, {
          contents: [{
            uri,
            mimeType: "text/plain",
            text: getStatus()
          }]
        });
      } else if (uri === "freeclaude://memory/today") {
        sendResult(id, {
          contents: [{
            uri,
            mimeType: "text/plain",
            text: readOptionalFile(OC_MEMORY_TODAY_PATH)
          }]
        });
      } else if (uri === "freeclaude://memory/longterm") {
        sendResult(id, {
          contents: [{
            uri,
            mimeType: "text/plain",
            text: readOptionalFile(OC_MEMORY_LONGTERM_PATH)
          }]
        });
      } else if (uri === "freeclaude://runs") {
        sendResult(id, {
          contents: [{
            uri,
            mimeType: "text/plain",
            text: formatRunSummaryList(readPersistedRunSummaries(FC_STATE_DIR))
          }]
        });
      } else if (uri === "freeclaude://sessions") {
        sendResult(id, {
          contents: [{
            uri,
            mimeType: "text/plain",
            text: formatSessionSummaryList(readPersistedSessionSummaries(FC_STATE_DIR))
          }]
        });
      } else {
        sendError(id, -32602, `Unknown resource: ${uri}`);
      }
      break;
    }
    
    case "notifications/initialized":
      // Client acknowledged initialization
      break;
      
    default:
      sendError(id, -32601, `Method not found: ${method}`);
  }
}

// Main loop - track pending requests
let pendingRequests = 0;
let inputClosed = false;

function checkExit() {
  if (inputClosed && pendingRequests === 0) {
    process.exit(0);
  }
}

rl.on("line", async (line) => {
  try {
    const msg = JSON.parse(line);
    pendingRequests++;
    try {
      await handleRequest(msg);
    } finally {
      pendingRequests--;
      checkExit();
    }
  } catch (err) {
    process.stderr.write(`MCP parse error: ${err.message}\n`);
  }
});

rl.on("close", () => {
  inputClosed = true;
  checkExit();
});
