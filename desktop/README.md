# FreeClaude Desktop

Native desktop app for FreeClaude — built with [Tauri](https://tauri.app) + vanilla TypeScript.

## Features

- 🖥 Native macOS/Windows/Linux app
- 💬 Chat interface with FreeClaude CLI
- 📡 Provider status panel
- 💰 Cost tracking dashboard
- ⌨️ Terminal-style input

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

## Architecture

```
┌──────────────────────────────┐
│  Tauri Window (HTML/CSS/JS)  │
│  ┌────────┬──────────────┐  │
│  │ Header │ Status Bar   │  │
│  ├────────┴──────────────┤  │
│  │                      │  │
│  │  Chat Messages       │  │
│  │                      │  │
│  ├──────────────────────┤  │
│  │  Input + Send        │  │
│  └──────────────────────┘  │
├──────────────────────────────┤
│  Rust Backend               │
│  - chat() → FreeClaude CLI  │
│  - get_providers()          │
│  - get_costs()              │
│  - get_version()            │
└──────────────────────────────┘
```

## Requirements

- Rust 1.70+
- Node.js 18+
- FreeClaude CLI (`npx freeclaude` or `~/.freeclaude/bin/freeclaude`)
