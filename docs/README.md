<div align="center">

# 🆓 FreeClaude v3.2.6 Documentation

**Local-first AI coding workspace — multi-provider, memory-enabled, voice-capable, MCP-ready**

[![npm version](https://img.shields.io/npm/v/@freeclaude/cli.svg)](https://www.npmjs.com/package/@freeclaude/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Built with](https://img.shields.io/badge/Built%20with-Bun-black)](https://bun.sh)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen)](https://nodejs.org)

</div>

---

## What is FreeClaude?

FreeClaude is a **fork of Anthropic's Claude Code** without the OAuth lock-in. It works with any OpenAI-compatible API provider — ZAI, Ollama, Gemini, DeepSeek, OpenRouter, and more. Think of it as your local-first AI coding assistant that respects your freedom to choose providers.

---

## 🚀 Quick Start (30 seconds)

```bash
# Option 1: npm (recommended)
npm install -g @freeclaude/cli

# Option 2: Git clone & build
git clone https://github.com/alexgrebeshok-coder/freeclaude.git
cd freeclaude
bun install && bun run build

# First run with guided setup
freeclaude --setup

# Or jump straight in
freeclaude
```

---

## Key Differences from Claude Code

| Feature | FreeClaude | Claude Code |
|---------|------------|-------------|
| **Price** | 🆓 Free/OSS | $20/month |
| **Auth** | API Key only | OAuth required |
| **Providers** | Multi-provider fallback | Anthropic only |
| **Voice Mode** | ✅ Free (Beta) | 🔒 Paid only |
| **Local Models** | ✅ Ollama, LM Studio | ❌ No |
| **Offline** | ✅ Works offline with Ollama | ❌ Cloud only |
| **Memory System** | ✅ Persistent + Session | Basic only |
| **MCP Servers** | ✅ Built-in CEOClaw + 1С | ❌ No |
| **Hooks** | ✅ 26 event types | Limited |
| **Telegram Bot** | ✅ Included | ❌ No |

---

## 📚 Documentation

- [**Installation**](INSTALLATION.md) — Install, configure providers, troubleshoot
- [**Commands**](COMMANDS.md) — All slash commands and CLI flags reference
- [**Providers**](PROVIDERS.md) — Full provider list with pricing and limits
- [**MCP**](MCP.md) — MCP server integration guide
- [**Memory**](MEMORY.md) — How /remember and /recall work
- [**Voice**](VOICE.md) — Voice mode setup and usage
- [**Telegram**](TELEGRAM.md) — Telegram bot installation
- [**Configuration**](CONFIGURATION.md) — Complete config reference
- [**Architecture**](ARCHITECTURE.md) — For developers (internals)
- [**Contributing**](CONTRIBUTING.md) — How to contribute
- [**FAQ**](FAQ.md) — Common questions answered
- [**Changelog**](CHANGELOG.md) — Version history

---

## Supported Providers

| Provider | Price | Best For | Status |
|----------|-------|----------|--------|
| 🇷🇺 **ZAI (GLM)** | Free | Russia users, Russian language | ✅ |
| 🏠 **Ollama** | Free | Local, offline, privacy | ✅ |
| 🌐 **Google Gemini** | Free tier | Global, fast | ✅ |
| 🔀 **OpenRouter** | Mixed | 200+ models in one | ✅ |
| 💰 **DeepSeek** | $0.14/M | Quality, reasoning | ✅ |
| ⚡ **Groq** | Free tier | Speed | ✅ |
| 🚀 **Cerebras** | Free tier | Ultra-fast inference | ✅ |

---

## Quick Commands

```bash
# Inside FreeClaude interactive mode:
/help              # Show all commands
/model             # Switch provider/model
/setup             # Add/remove providers
/cost              # Check usage costs
/remember key val  # Save to memory
/recall key        # Retrieve from memory
/doctor            # System health check
/run task desc     # Background task
/hooks             # Manage automation hooks
```

---

## Example Session

```bash
$ freeclaude
🆓 FreeClaude v3.2.6 | Provider: zai | Model: glm-4.7-flash
> /model
1. zai (glm-4.7-flash) [ACTIVE]
2. ollama (qwen2.5:3b)
3. gemini (gemini-2.5-flash-lite)

> /model 2
Switched to ollama (qwen2.5:3b)

> Refactor this React component to use hooks
[AI analyzes and edits files...]

> /remember prefers-hooks "User prefers functional components with hooks"
Saved to memory.

> /commit
Analyzed changes:
- Refactored UserProfile to use hooks
- Extracted useUserData custom hook
✓ Committed with message: "refactor: convert UserProfile to hooks"
```

---

## Requirements

- **Node.js** >= 20.0.0
- **OS**: macOS, Linux, Windows (WSL)
- **Build tool**: Bun (recommended) or npm

---

## Links

- 📦 **npm**: https://www.npmjs.com/package/@freeclaude/cli
- 🐙 **GitHub**: https://github.com/alexgrebeshok-coder/freeclaude
- 📝 **Issues**: https://github.com/alexgrebeshok-coder/freeclaude/issues
- 💬 **Discussions**: https://github.com/alexgrebeshok-coder/freeclaude/discussions

---

<div align="center">

**Made with 🐾 by FreeClaude contributors**

[MIT License](LICENSE) · Free forever · Open source

</div>
