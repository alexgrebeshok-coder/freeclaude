# Architecture

> Status: stub. Full architecture deep dive is part of the 1.0 docs pass.

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

## To do for 1.0

- Diagram with per-IPC channel arrows (chat, terminal, fs, config).
- Document the diagnostic / requestId correlation protocol (P2).
- Document `electron-updater` feed and signing pipeline (P6).
