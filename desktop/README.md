# FreeClaude Desktop

Native desktop client for the FreeClaude CLI.

- **Stack**: Electron Forge + Vite + React 19 + TypeScript.
- **Status**: alpha approaching 1.0. macOS arm64/x64 first.
- **Entry point**: `src/main/bootstrap.ts` (compiled to `.vite/build/bootstrap.js`).

The renderer is a single-window React app providing chat, terminal, file
browsing, settings and inspector panels. The main process spawns the FreeClaude
CLI and streams `--output-format stream-json` events back to the renderer over
a typed IPC bridge.

## Layout

```
desktop/
  src/
    main/        # Electron main process (window, IPC, bridge, terminal, fs)
    preload/     # contextBridge surface
    renderer/    # React UI
    shared/      # zod-typed IPC contract shared by main + preload + renderer
  legacy/
    src-tauri/   # archived original Tauri + Rust shell (reference only)
    tauri-shell/ # archived vanilla-TS renderer for the Tauri shell
  scripts/       # build + packaging helpers
  test/          # vitest (added in P7)
  e2e/           # playwright electron e2e (added in P7)
  forge.config.js
  vite.*.config.ts
```

## Develop

```bash
cd desktop
npm install
npm run dev          # electron-forge start (Vite + Electron)
npm run typecheck
npm run lint
```

The app needs the FreeClaude CLI on `PATH` or at one of:
`$FREECLAUDE_PATH`, `~/.freeclaude/bin/freeclaude`, `/opt/homebrew/bin/freeclaude`,
`/usr/local/bin/freeclaude`. Local provider config lives at `~/.freeclaude.json`.

## Build

```bash
cd desktop
npm run package      # produce .app
npm run make         # build distributables (dmg + zip) into out/make
npm run launch       # make + open the packaged app
npm run install:mac  # make + copy into /Applications and launch
```

Signing and notarization are wired in `forge.config.js` (P6); see
[RELEASE.md](./RELEASE.md) for the release pipeline (added in P8).

## Configuration storage

| Concern | Path | Source of truth |
|---|---|---|
| Provider definitions, active provider/model, API keys | `~/.freeclaude.json` | CLI |
| Desktop overrides (theme, font size, last selected model) | `<userData>/FreeClaude/config/settings.json` | desktop |
| UI session state (chats, projects, drafts) | renderer `localStorage` (`freeclaude-shell-state`) | renderer |
| Logs | `<userData>/FreeClaude/logs/freeclaude.log` (rotated) | main |

Migrations for the renderer state live in `src/renderer/migrations/`.

## Lockfile policy

- `desktop/package-lock.json` for the Electron app (`npm`).
- Root `bun.lock` is only for the CLI package and is unrelated to this folder.
- Do not introduce a workspace manager here — the desktop folder is an
  intentionally standalone npm package so that Forge + node-pty native builds
  stay isolated from the CLI's Bun toolchain.

## Legacy

The original Tauri + Rust shell and its vanilla-TS renderer have been moved to
[`legacy/`](./legacy/README.md) for reference only. They are not built or
shipped.
