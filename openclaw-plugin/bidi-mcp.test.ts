import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PM_TOOLS,
  buildProjectContextText,
  handlePmToolCall,
} from "./bidi-mcp.mjs";
import {
  savePersistedRuns,
  savePersistedSessions,
} from "./runtime-state.mjs";

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createStateDir() {
  const dir = mkdtempSync(join(tmpdir(), "fc-bidi-mcp-"));
  tempDirs.push(dir);
  return dir;
}

describe("bidirectional MCP helpers", () => {
  test("exposes PM and shared-context tools", () => {
    const names = PM_TOOLS.map((tool) => tool.name);
    expect(names).toContain("pm_project_create");
    expect(names).toContain("pm_task_update");
    expect(names).toContain("freeclaude_project_context");
  });

  test("persists PM projects and tasks in plugin state", () => {
    const stateDir = createStateDir();

    const createdProject = JSON.parse(
      handlePmToolCall(
        "pm_project_create",
        {
          name: "CEO sync",
          budget: 250000,
          startDate: "2026-04-17",
          sessionKey: "sync-1",
          workdir: "/repo/app",
        },
        { stateDir },
      ),
    );
    const projectId = createdProject.project.id;

    const createdTask = JSON.parse(
      handlePmToolCall(
        "pm_task_create",
        {
          projectId,
          title: "Wire PM MCP",
          priority: "high",
        },
        { stateDir },
      ),
    );

    const listed = JSON.parse(
      handlePmToolCall("pm_project_list", { sessionKey: "sync-1" }, { stateDir }),
    );
    const status = JSON.parse(
      handlePmToolCall("pm_status", { projectId }, { stateDir }),
    );

    expect(createdTask.success).toBe(true);
    expect(listed.total).toBe(1);
    expect(listed.projects[0].name).toBe("CEO sync");
    expect(status.context.sessionKey).toBe("sync-1");
    expect(status.tasks.total).toBe(1);
  });

  test("builds shared project context from PM state, runs, sessions, and memory", () => {
    const stateDir = createStateDir();

    JSON.parse(
      handlePmToolCall(
        "pm_project_create",
        {
          name: "Shared context",
          budget: 100000,
          startDate: "2026-04-17",
          sessionKey: "chat-42",
          workdir: "/repo/core",
        },
        { stateDir },
      ),
    );

    const runs = new Map([
      [
        "run-1",
        {
          runId: "run-1",
          status: "completed",
          task: "Review auth flow",
          mode: "review",
          workdir: "/repo/core",
          summary: "Reviewed auth flow",
          startedAt: Date.now() - 1000,
          updatedAt: Date.now(),
        },
      ],
    ]);
    savePersistedRuns(stateDir, runs);

    const sessions = new Map([
      [
        "chat-42",
        {
          sessionKey: "chat-42",
          freeClaudeSessionId: "fc-session-1",
          workdir: "/repo/core",
          mode: "review",
          lastRunId: "run-1",
          lastStatus: "completed",
          summary: "Reviewed auth flow",
          updatedAt: Date.now(),
        },
      ],
    ]);
    savePersistedSessions(stateDir, sessions);

    const text = buildProjectContextText({
      stateDir,
      sessionKey: "chat-42",
      workdir: "/repo/core",
      memoryTodayText: "Need to sync PM and coding status.",
      memoryLongtermText: "Project prefers structured delegation.",
    });

    expect(text).toContain("Shared context");
    expect(text).toContain("fc-session-1");
    expect(text).toContain("run-1");
    expect(text).toContain("Need to sync PM and coding status.");
    expect(text).toContain("Project prefers structured delegation.");
  });
});
