# Legacy desktop stacks

This folder is **archive**. None of the code below is built or shipped by the
current FreeClaude desktop product (Electron Forge + React + Vite, see
`desktop/src/`).

It is kept in-tree as a **reference** for porting individual capabilities
(costs reader, runtime status, task templates, vault notes, voice readiness)
into the Electron app during the 1.0 assembly plan.

## Contents

- `src-tauri/` — original Tauri + Rust shell. Implements:
  - `chat` (CLI `--print` text), `get_providers`, `get_costs`,
    `get_version`, `get_runtime_status`
  - task list/run/resume/cancel, templates, schedules
  - `list_vault_notes`
  - voice readiness probes (SoX `rec`, `whisper-cli`, `ffmpeg`)
  - All commands shell out to the FreeClaude CLI; canonical config lives in
    `~/.freeclaude.json`.
- `tauri-shell/` — the matching vanilla TypeScript renderer for the Tauri
  shell (six-screen layout: Inbox/Review, Running Tasks, New Task, Providers
  & Runtime, Usage/Cost, Memory Vault). Files were previously at
  `desktop/src/main.ts`, `desktop/src/ipc.ts`, `desktop/src/screens.ts`,
  `desktop/src/types.ts`, `desktop/src/styles.css`, `desktop/src/assets/`.

## Status

Out of scope for FreeClaude Desktop 1.0. Selected behaviours (costs,
runtime status) will be ported into the Electron `freeclaude-bridge` /
`bootstrap` modules in a later phase. Tasks/schedules/vault and voice
readiness are explicitly parked for a post-1.0 iteration.

If you delete this folder, do it after those features have been re-implemented
in the Electron app and corresponding tests live in `desktop/test/`.
