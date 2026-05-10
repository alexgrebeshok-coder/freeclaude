# Configuration

> Status: stub. Full reference is being assembled as part of the FreeClaude
> 1.0 documentation pass. This page tracks the canonical configuration story
> across the CLI, desktop app, VS Code extension and MCP servers.

## Files at a glance

| File | Owner | Purpose |
|---|---|---|
| `~/.freeclaude.json` | CLI (canonical) | Provider definitions, API keys, active provider/model, defaults. Schema in [`src/utils/freeclaudeConfig.ts`](../src/utils/freeclaudeConfig.ts). |
| `<userData>/FreeClaude/config/settings.json` | Desktop app | UI overrides: theme, font size, last selected model. The desktop app falls back to `~/.freeclaude.json` whenever a key is missing here. |
| `<userData>/FreeClaude/logs/freeclaude.log` | Desktop app | Rolling JSONL log written by the main process (added in 1.0). |
| `~/.freeclaude/costs.jsonl` | CLI | Per-call cost ledger consumed by `/cost`. |

`<userData>` resolves to `~/Library/Application Support/FreeClaude` on macOS,
`%APPDATA%/FreeClaude` on Windows and `~/.config/FreeClaude` on Linux.

## Environment variables

| Variable | Purpose |
|---|---|
| `FREECLAUDE_PATH` | Absolute path to the CLI binary (overrides PATH lookup). |
| `FREECLAUDE_CONFIG_PATH` | Override the location of `~/.freeclaude.json`. |
| `FREECLAUDE_API_KEY` / `FREECLAUDE_PROVIDER` / `FREECLAUDE_MODEL` | Last-mile overrides forwarded to the CLI by the desktop bridge. |

## Provider discovery precedence (desktop)

1. Active provider/model written to `<userData>/.../settings.json` (last user choice in Settings).
2. `activeProvider` / `activeModel` from `~/.freeclaude.json`.
3. First provider listed in `~/.freeclaude.json`.

The desktop app never duplicates API keys it does not own — keys live in
`~/.freeclaude.json` and the CLI reads them directly when spawned.

## To do for 1.0

- Document each provider block (baseUrl/apiKey/model/priority/timeout).
- Document `defaults.maxRetries` / `retryDelay` / `logLevel`.
- Provide a JSON schema and ship it as `~/.freeclaude.schema.json`.
