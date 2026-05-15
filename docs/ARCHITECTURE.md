# Architecture

The **full bilingual architecture pack** (FreeClaude + Pyrfor + CEOClaw, macro/micro diagrams, EN/RU) lives under **[`docs/architecture/`](architecture/README.md)**. Start at [`architecture/README.md`](architecture/README.md) for the index.

This page keeps a **short** ASCII overview of FreeClaude-only surfaces in *this* repo.

FreeClaude ships as four cooperating surfaces:

```
                   +-----------------------------+
                   |       FreeClaude CLI        |
                   |  (this repo, src/)          |
                   |  spawns providers, runs     |
                   |  tools, owns ~/.freeclaude  |
                   +--------------+--------------+
                                  ^
              stream-json / stdio |
                                  |
+------------------+   IPC   +----+--------+   IPC   +-----------------+
|  VS Code ext     |<------->|  Desktop    |<------->|  MCP servers    |
|  (extension/)    |         |  (Electron) |         |  (mcp-servers/) |
|  - chat panel    |         |  (desktop/) |         |  - CEOClaw etc. |
|  - file actions  |         |  - chat     |         +-----------------+
+------------------+         |  - terminal |
                             |  - files    |
                             |  - settings |
                             +-------------+
```

## Process boundaries (desktop)

- **Main**: `desktop/src/main/bootstrap.ts` owns the BrowserWindow, the
  FreeClaude bridge (`freeclaude-bridge.ts`), the terminal manager
  (`terminal.ts`) and the file manager (`file-manager.ts`).
- **Preload**: `desktop/src/preload/preload.ts` exposes a typed bridge through
  `contextBridge`. Channel names + payload schemas live in
  `desktop/src/shared/ipc-contract.ts` (added in 1.0).
- **Renderer**: React app under `desktop/src/renderer/`. Validates everything
  it sends through the same shared contract.

## CLI contract

The desktop app spawns:

```
freeclaude [-p] [--resume <sessionId>] --output-format stream-json <prompt>
```

and parses newline-delimited JSON events (`session_id`, `assistant`, `result`,
`is_error`). The CLI source for the streaming path is
[`src/entrypoints/cli.tsx`](../src/entrypoints/cli.tsx).

## Further reading in this repo

- [`architecture/00-ecosystem-macro.md`](architecture/00-ecosystem-macro.md) — how Pyrfor and FreeClaude products relate
- [`architecture/02-freeclaude-desktop.md`](architecture/02-freeclaude-desktop.md) — Electron IPC detail
- [`architecture/03-mcp-ceoclaw-and-integrations.md`](architecture/03-mcp-ceoclaw-and-integrations.md) — MCP / CEOClaw

## To do for 1.0

- Diagram with per-IPC channel arrows (chat, terminal, fs, config).
- Document the diagnostic / requestId correlation protocol (P2).
- Document `electron-updater` feed and signing pipeline (P6).
