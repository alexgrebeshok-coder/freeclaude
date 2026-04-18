# Changelog

All notable changes to FreeClaude are documented in this file.

## [3.2.8] - 2025-07

### Runtime Reliability
- Fixed `shouldFallback()` to detect network errors (ECONNREFUSED, ETIMEDOUT, fetch failures)
  and trigger automatic provider fallback
- Added agent circuit breaker — prevents infinite recursive agent spawns (max depth 5)
- Improved "all providers exhausted" error with per-provider failure details and recovery suggestions
- Better `describeProviderError()` with specific messages for 401, 429, 5xx, and network errors
- Created typed error hierarchy (`freeclaudeErrors.ts`) for structured error handling

### Telegram Bot
- Smart message splitting: respects code block boundaries and paragraph breaks instead of raw character cuts
- Progress indicator for long-running requests (shows ⏳ after 3 seconds)
- Structured error messages with user-friendly explanations (network, rate limit, timeout, provider failures)
- Localized error output (Russian)

### Testing & CI
- Added `test:all` script — runs all 114 tests (86 bun + 28 node) in one command
- Live GitHub Actions CI badge in README (replaces static badge)

### Developer Experience
- All 86 bun tests + 28 node tests passing
- Build verified: `dist/cli.mjs`, `dist/telegram.mjs`

---

## [3.0.0] - 2026-04-12

FreeClaude v3.0.0 is the first launch-ready stable release of the project. It completes the shift from an alpha rebrand into a full multi-surface AI coding agent with desktop, editor, MCP, automation, and packaging support.

### Highlights

- Stable `3.0.0` release after the FreeClaude rebrand from Open Claude.
- End-to-end feature set across CLI, Desktop, VS Code, MCP servers, hooks, plugins, and background agents.
- Launch-ready distribution work for Docker, npm packaging, and Homebrew installation paths.

### Phase 0: Quality Foundation and Branding

- Established the v3 quality baseline with test coverage expansion, CI improvements, provider/runtime hardening, and build verification work.
- Completed the branding transition from Open Claude to FreeClaude across the product, docs, startup surfaces, and desktop shell.
- Fixed core v2 carry-over issues around fallback integration, path handling, provider validation, and cost accounting foundations.

### Phase 1: Core Features

- Added git workflow commands including `/undo` rollback support and `/repo-map` repository overviewing.
- Shipped Voice Mode using Whisper STT for speech input and Edge TTS for speech output.
- Expanded the multi-provider fallback chain with smarter retries, provider switching, and cost-aware behavior.
- Added cost tracking and reporting so sessions can inspect spend over time.
- Rounded out session memory workflows with commands such as `/remember`, `/recall`, `/forget`, and `/memories`.

### Phase 2: Differentiation

- Productized the hooks system with 26 hook types for automation, safety, and workflow customization.
- Delivered the plugin system for extending commands, tools, prompts, and integrations.
- Added the Desktop App as a Tauri MVP, giving FreeClaude a native cross-platform shell.

### Phase 3: Ecosystem

- Added a VS Code extension for chat-driven coding workflows inside the editor.
- Shipped MCP server support with two flagship integrations:
- CEOClaw PM MCP for project-management workflows and PM metrics.
- 1С OData MCP for read-only enterprise data access against 1С deployments.
- Added Background Agents for longer-running work with `/run`, `/jobs`, and `/job`.

### Phase 4: Launch Preparation

- Prepared Docker support for containerized installs and reproducible runtime environments.
- Finalized npm package readiness for `@freeclaude/cli`.
- Added Homebrew distribution preparation for streamlined installation on macOS and Linux environments.
- Polished release documentation, badges, and packaging metadata for the public 3.0.0 launch.

### Metrics

- Approximately 392K lines of code across the CLI, desktop app, extension, MCP servers, and supporting systems.
- 70+ automated tests covering core release flows.
- 12+ slash commands spanning git, providers, memory, cost tracking, hooks, and background jobs.

### Notes

- This release marks the completion of Phases 0 through 4 from the v3 master plan.
- The primary focus of `3.0.0` is breadth, packaging readiness, and stable launch polish rather than a single breaking migration.
