# FreeClaude Desktop (Alpha)

Alpha desktop orchestration client for FreeClaude, built with [Tauri](https://tauri.app) + vanilla TypeScript.

## Current Status

- Alpha surface, not the primary product workflow yet
- Local shell for desktop packaging and runtime integration work
- Not yet a full task inbox, review queue, or multi-agent command center

## Features

- 🖥 Native macOS/Windows/Linux shell
- 🔌 Local integration point for the FreeClaude CLI
- 🧪 Surface for desktop runtime and packaging iteration

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

## Near-term Direction

The intended direction is a desktop command center with:

- Inbox/Review
- Running Tasks
- New Task
- Providers and Runtime
- Usage/Cost
- Memory Vault

## Requirements

- Rust 1.70+
- Node.js 18+
- FreeClaude CLI (`freeclaude` on PATH or a local build)
