# Architecture documentation pack

Bilingual (English / Русский) macro- and micro-architecture notes for **FreeClaude**, **Pyrfor**, **CEOClaw**, and cross-repo **FreeClaude Engine** integration.

| Doc | Topic |
|-----|--------|
| [00-ecosystem-macro.md](./00-ecosystem-macro.md) | System boundaries, persistence, product diagram |
| [01-freeclaude-cli-core.md](./01-freeclaude-cli-core.md) | CLI entry, QueryEngine, subsystems |
| [02-freeclaude-desktop.md](./02-freeclaude-desktop.md) | Electron main/preload/renderer, IPC, CLI spawn |
| [03-mcp-ceoclaw-and-integrations.md](./03-mcp-ceoclaw-and-integrations.md) | MCP, CEOClaw, 1C OData |
| [04-pyrfor-engine-and-fc-integration.md](./04-pyrfor-engine-and-fc-integration.md) | Pyrfor engine + `runFreeClaude` adapter graph |
| [05-pyrfor-ide-and-vscode-extension.md](./05-pyrfor-ide-and-vscode-extension.md) | Tauri IDE + VS Code extension map |
| [06-routines-and-unification-roadmap.md](./06-routines-and-unification-roadmap.md) | Routines plan vs Pyrfor cron/gateway |

Upstream feature docs: [MCP.md](../MCP.md), [MEMORY.md](../MEMORY.md), [ROUTINES_PLAN.md](../../ROUTINES_PLAN.md), root [README.md](../../README.md). Pyrfor integration matrix: [integrations.md (Pyrfor repo)](https://github.com/alexgrebeshok-coder/pyrfor/blob/main/docs/integrations.md).

If both repositories are cloned locally (e.g. `freeclaude-dev` and `pyrfor-dev`), you can open files under `pyrfor-dev/packages/engine/src/runtime/` beside this documentation for line-accurate review.
