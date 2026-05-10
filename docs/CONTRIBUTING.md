# Contributing

> Status: stub. We are tightening this as part of FreeClaude 1.0.

## Quick start

```bash
git clone https://github.com/alexgrebeshok-coder/freeclaude.git
cd freeclaude
bun install
bun run build           # build the CLI
node dist/cli.mjs       # run the local CLI

cd desktop
npm install
npm run dev             # run the Electron app against the local CLI
```

## Project layout

- `src/` — FreeClaude CLI (Bun + TypeScript + React/Ink REPL).
- `desktop/` — Electron desktop app (Electron Forge + Vite + React).
- `extension/` — VS Code extension.
- `mcp-servers/` — standalone MCP servers (CEOClaw etc.).
- `docs/` — user docs.
- `bin/` — published CLI entry shims.
- `desktop/legacy/` — archived Tauri shell (reference only).

## Before opening a PR

- `bun run typecheck` for the CLI.
- `npm --prefix desktop run typecheck && npm --prefix desktop run lint` for the desktop app.
- `npm --prefix extension run typecheck` for the VS Code extension.
- Add or update tests when behaviour changes (desktop tests live in
  `desktop/test/` once P7 lands; CLI tests live in `tests/`).

## Reporting issues

Use [GitHub Issues](https://github.com/alexgrebeshok-coder/freeclaude/issues)
and include: OS + version, CLI version (`freeclaude --version`), provider in
use and a redacted snippet of `~/.freeclaude.json`.

## Security

Do not file public issues for vulnerabilities. Email the maintainer listed in
the npm package metadata.
