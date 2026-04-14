# FreeClaude Desktop (Concept)

> ⚠️ **This is a design prototype.** It does not build or run as a standalone application.
> See the CLI (`freeclaude` / `node dist/cli.mjs`) for the working product.

Design-stage desktop orchestration client for FreeClaude, built with [Tauri](https://tauri.app) + vanilla TypeScript.

## Current Status

- **Concept / design prototype** — source files exist but the app is not buildable or shippable
- Contains planned six-screen layout (Inbox/Review, Running Tasks, New Task, Providers/Runtime, Usage/Cost, Memory Vault)
- Tauri Rust bridge code sketches IPC commands for task management
- Not connected to a working build pipeline

## Features

- 🖥 Native macOS/Windows/Linux shell
- 🔌 Direct local integration with the FreeClaude CLI
- 📥 Inbox/Review, Running Tasks, New Task, Providers & Runtime, Usage/Cost, and Memory Vault screens
- 🚀 Launch, list, resume, cancel, and inspect local background tasks
- 📡 Runtime/provider/cost visibility, including optional voice readiness diagnostics
- 🧪 Alpha surface for desktop runtime and packaging iteration

## Development

```bash
cd desktop
npm install
npm run tauri dev
```

## Build

```bash
cd desktop
npm run tauri build
```

## Current Gaps

The desktop app is now a real orchestration alpha, but it still needs:

- richer live streaming beyond local event polling
- approval prompts and diff/worktree actions
- stronger review queue workflows
- vault editing and Obsidian-facing actions

## Requirements

- Rust 1.70+
- Node.js 18+
- FreeClaude CLI (`freeclaude` on PATH or a local build)
