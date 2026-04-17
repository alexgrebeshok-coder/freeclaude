# Commands Reference

Complete reference for all FreeClaude commands — slash commands (interactive mode) and CLI flags.

## CLI Flags

### Entry Point
```bash
freeclaude [options] [prompt]
fc [options] [prompt]           # Short alias
```

### Core Options

| Flag | Description | Example |
|------|-------------|---------|
| `-p, --print` | Print response and exit (non-interactive) | `fc -p "explain React hooks"` |
| `-c, --continue` | Continue last conversation | `fc -c` |
| `-r, --resume [id]` | Resume session by ID | `fc -r abc-123` |
| `--model <model>` | Specify model | `fc --model gpt-4o` |
| `--name <name>` | Name the session | `fc --name "Bug hunt"` |
| `-d, --debug` | Enable debug mode | `fc -d` |
| `--bare` | Minimal mode (skip hooks, LSP, plugins) | `fc --bare` |
| `-v, --version` | Show version | `fc -v` |
| `-h, --help` | Show help | `fc --help` |

### Advanced Options

| Flag | Description | Example |
|------|-------------|---------|
| `--allowed-tools <list>` | Allow specific tools only | `--allowed-tools "Bash,Edit,Read"` |
| `--disallowed-tools <list>` | Block specific tools | `--disallowed-tools "Bash(rm:)"` |
| `--permission-mode <mode>` | Set permission mode | `--permission-mode acceptEdits` |
| `--mcp-config <file>` | Load MCP servers from file | `--mcp-config mcp.json` |
| `--strict-mcp-config` | Only use MCP from --mcp-config | `--strict-mcp-config` |
| `--system-prompt <text>` | Custom system prompt | `--system-prompt "You are..."` |
| `--append-system-prompt <text>` | Append to system prompt | `--append-system-prompt "Always..."` |
| `--plugin-dir <path>` | Load plugins from directory | `--plugin-dir ./plugins` |
| `--settings <file>` | Load settings JSON | `--settings settings.json` |
| `--effort <level>` | Effort level (low/medium/high/max) | `--effort high` |
| `--max-budget-usd <amount>` | Max spend limit | `--max-budget-usd 5.00` |
| `--fallback-model <model>` | Fallback model | `--fallback-model gpt-4o-mini` |
| `--output-format <format>` | Output format | `--output-format json` |
| `--session-id <uuid>` | Use specific session ID | `--session-id xxxx...` |
| `--worktree [name]` | Create git worktree | `--worktree feature-branch` |
| `--tmux` | Create tmux session | `--tmux --worktree` |
| `--chrome` | Enable Chrome integration | `--chrome` |
| `--no-chrome` | Disable Chrome | `--no-chrome` |
| `--voice` | Voice mode | `--voice` |

### Input/Output Options

| Flag | Description | Example |
|------|-------------|---------|
| `--input-format <format>` | Input format (text/stream-json) | `--input-format stream-json` |
| `--output-format <format>` | Output format (text/json/stream-json) | `--output-format stream-json` |
| `--json-schema <schema>` | JSON schema for output | `--json-schema '{"type":"object"}'` |
| `--include-partial-messages` | Stream partial messages | `--include-partial-messages` |
| `--no-session-persistence` | Don't save session | `--no-session-persistence` |
| `--file <spec>` | Load file resource | `--file file_abc:doc.txt` |

---

## Slash Commands (Interactive Mode)

### Basic Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/help` | Show all available commands | `/help` |
| `/exit` | Exit FreeClaude | `/exit` |
| `/clear` | Clear screen | `/clear` |
| `/status` | Show current session status | `/status` |

### Provider & Model Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/model` | List and switch providers | `/model` → interactive |
| `/model <n>` | Switch to provider #n | `/model 2` |
| `/model <name>` | Switch to provider by name | `/model ollama` |
| `/model <provider> <model>` | Change model within provider | `/model openrouter anthropic/claude-sonnet-4` |
| `/setup` | Open setup menu | `/setup` |
| `/setup <category>` | Filter by category | `/setup free` (free providers) |
| `/setup <provider>` | Quick add provider | `/setup zai` |
| `/setup add <n> <key>` | Add provider with key | `/setup add 2 my-api-key` |
| `/setup remove <n>` | Remove provider | `/setup remove 2` |
| `/providers test` | Test all providers (latency) | `/providers test` |
| `/providers` | List providers | `/providers` |

**Setup categories:** `free`, `local`, `paid`, `router`, `all`

### Git Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/commit` | AI commit with analysis | `/commit` |
| `/diff` | Show uncommitted changes | `/diff` |
| `/undo [n]` | Undo last n commits (soft reset) | `/undo` or `/undo 3` |
| `/repo-map` | Show repository structure | `/repo-map` |
| `/branch` | Branch operations | `/branch` |

### Memory Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/remember <key> <value>` | Save fact to memory | `/remember tech "Prefers TypeScript"` |
| `/recall <key>` | Retrieve from memory | `/recall tech` |
| `/forget <key>` | Delete from memory | `/forget tech` |
| `/memories` | List all memories | `/memories` |
| `/daily` | Daily notes / memory management | `/daily` |
| `/vault` | Vault operations | `/vault list` |

### Cost & Usage Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/cost` | Show cost statistics | `/cost` |
| `/cost today` | Today's costs | `/cost today` |
| `/cost week` | This week's costs | `/cost week` |
| `/cost month` | This month's costs | `/cost month` |
| `/usage` | Detailed usage stats | `/usage` |

### Task Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/run <task>` | Run background task | `/run "analyze codebase"` |
| `/jobs` | List background jobs | `/jobs` |
| `/job <id>` | Show job results | `/job abc-123` |
| `/routine` | Routine management | `/routine list` |

Task protocol (CLI):
```bash
freeclaude task list --json
freeclaude task run --json "summarize changed files"
freeclaude task resume --json <task-id>
freeclaude task cancel --json <task-id>
freeclaude task template list --json
```

### Hook Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/hooks` | Manage hooks | `/hooks` |
| `/hooks list` | List configured hooks | `/hooks list` |
| `/hooks enable <name>` | Enable a hook | `/hooks enable prevent-secret-commit` |
| `/hooks disable <name>` | Disable a hook | `/hooks disable auto-format-check` |

**Built-in hooks:**
- `prevent-secret-commit` — Warns before committing .env/credentials
- `prevent-rm-without-trash` — Blocks `rm -rf`, suggests `trash`
- `auto-format-check` — Suggests formatting after edits
- `git-commit-tracker` — Tracks AI commits for `/undo`
- `long-task-notify` — Notifications for slow tasks

### MCP Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/mcp` | MCP server management | `/mcp` |
| `/mcp list` | List MCP servers | `/mcp list` |
| `/mcp add <config>` | Add MCP server | `/mcp add ./mcp.json` |

### Voice Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/voice` | Toggle voice mode | `/voice` |

### Doctor & Diagnostics

| Command | Description | Usage |
|---------|-------------|-------|
| `/doctor` | System health check | `/doctor` |
| `/doctor --json` | JSON output | `/doctor --json` |

### Memory & Context

| Command | Description | Usage |
|---------|-------------|-------|
| `/memory` | Edit CLAUDE.md files | `/memory` |
| `/compact` | Compact conversation history | `/compact` |
| `/context` | Show context info | `/context` |

### Other Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/theme` | Change color theme | `/theme` |
| `/config` | Configuration editor | `/config` |
| `/skills` | Manage skills | `/skills` |
| `/plugin` | Plugin management | `/plugin` |
| `/upgrade` | Check for updates | `/upgrade` |
| `/version` | Show version | `/version` |
| `/exit` | Exit | `/exit` |

---

## Command Groups

### 🔧 Basic (Essential)
- `/help`, `/status`, `/exit`, `/clear`

### 🔄 Providers
- `/model`, `/setup`, `/providers`

### 💾 Git
- `/commit`, `/diff`, `/undo`, `/repo-map`

### 🧠 Memory
- `/remember`, `/recall`, `/forget`, `/memories`, `/daily`

### 💰 Cost
- `/cost`, `/usage`

### ⚡ Tasks
- `/run`, `/jobs`, `/job`, `/routine`

### 🛡️ Safety
- `/hooks`, `/doctor`

### 🔌 Advanced
- `/mcp`, `/voice`, `/config`, `/skills`, `/plugin`

---

## Examples

### Switching Providers
```
> /model
1. zai (glm-4.7-flash) [ACTIVE]
2. ollama (qwen2.5:7b)
3. gemini (gemini-2.5-flash-lite)

> /model 2
Switched to ollama (qwen2.5:7b)
```

### Quick Setup
```
> /setup free
Free providers:
1. ZAI (GLM) - Free
2. Ollama (local) - Free
3. Gemini - Free tier

> /setup add 1 my-zai-key
Added ZAI provider
```

### Commit Flow
```
> /diff
[shows uncommitted changes]

> /commit
AI analyzes...
Suggested message: "feat: add user authentication"
✓ Committed abc1234

> /undo
Undid last commit (soft reset)
```

### Memory Usage
```
> /remember stack "I prefer React over Vue"
Saved to memory.

> /recall stack
I prefer React over Vue

> /memories
[1] stack: I prefer React over Vue
[2] editor: Uses Vim keybindings
```

### Background Tasks
```
> /run "analyze all TODO comments in src/"
Task queued: task-abc-123

> /jobs
[1] task-abc-123: analyzing... (started 2m ago)

> /job task-abc-123
Found 12 TODOs:
- src/utils.ts:42 - Refactor this
- src/api.ts:15 - Add error handling
...
```
