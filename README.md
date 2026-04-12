<div align="center">

# 🆓 FreeClaude v3

**The Best Free AI Coding Agent — Fallback Chain, Semantic Memory, Voice, MCP, PM Tools**

Fork of Claude Code without OAuth lock-in. Works with any OpenAI-compatible provider.

[![v3.0.0-alpha.1](https://img.shields.io/badge/version-3.0.0--alpha.1-orange)](https://github.com/alexgrebeshok-coder/freeclaude/releases)
[![Phase 4](https://img.shields.io/badge/Phase-0..3%20Done%20%7C%20Sprint%206-8%20Done-green)](https://github.com/alexgrebeshok-coder/freeclaude)
[![Tests](https://img.shields.io/badge/tests-70%2F70%20pass-brightgreen)](https://github.com/alexgrebeshok-coder/freeclaude)
[![Rust](https://img.shields.io/badge/Rust-Tauri%20Desktop-orange)](https://github.com/alexgrebeshok-coder/freeclaude/tree/main/desktop)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue)](https://github.com/alexgrebeshok-coder/freeclaude/tree/main/extension)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

[English](#english) · [Русский](#русский)

</div>

---

## 🇷🇺 Русский

### Что нового в v3

| Фаза | Фичи | Статус |
|------|-------|--------|
| **Phase 0** | 🔧 Quality foundation, branding, CI/CD | ✅ |
| **Phase 1** | 🗂️ `/undo`, `/repo-map`, Voice, Fallback, Memory, Cost tracking | ✅ |
| **Phase 2** | 🪝 Hooks (26 types), Plugins (20K+ lines), Desktop App (Tauri) | ✅ |
| **Phase 3** | 💻 VS Code Extension, MCP servers, Background Agents | ✅ |
| **Phase 4** | 🚀 Launch: npm, Homebrew, Docker | 🔄 |

### Уникальные фичи (нет у конкурентов)

- 🏗️ **CEOClaw PM MCP** — управление проектами прямо в coding agent (EVM, CPI, SPI)
- 🏢 **1С OData MCP** — доступ к данным 1С:Предприятие (Альфа-Авто, БАЗИС)
- 🔄 **Multi-Provider Fallback** — автоматическое переключение между ZAI, Ollama, Gemini
- 🧠 **GBrain Semantic Memory** — семантическая память через локальные embeddings
- 🎙️ **Voice Mode** — Whisper STT + Edge TTS (бесплатно, локально)
- 🇷🇺 **Russian Locale** — полная поддержка русского языка

### Быстрый старт

```bash
# 1. Clone & build
git clone https://github.com/alexgrebeshok-coder/freeclaude.git
cd freeclaude
bun install && bun run build

# 2. Configure providers
cp .freeclaude.example.json ~/.freeclaude.json
# Edit ~/.freeclaude.json with your API keys

# 3. Start coding!
node dist/cli.mjs
```

### Поддерживаемые провайдеры

| Провайдер | Цена | Модель | Статус |
|-----------|------|--------|--------|
| 🇷🇺 **ZAI (GLM)** | Бесплатно | glm-4.7-flash, glm-5-turbo, **glm-5.1** | ✅ |
| 🏠 **Ollama** | Бесплатно | qwen2.5:3b, llama3, any local | ✅ |
| 🌐 **Google Gemini** | Free tier | gemini-2.5-flash-lite | ✅ |
| 💰 **OpenAI** | Paid | gpt-4o, gpt-4o-mini | ✅ |
| 💰 **DeepSeek** | Cheap | deepseek-chat, deepseek-r1 | ✅ |
| 🔧 **Any OpenAI-compatible** | — | any model | ✅ |

### Slash Commands

| Команда | Описание |
|---------|----------|
| `/commit` | AI-коммит с анализом изменений |
| `/diff` | Просмотр незакоммиченных изменений |
| `/undo [N]` | Откат последних N коммитов (soft reset) |
| `/repo-map` | Обзор структуры репозитория |
| `/setup` | Автоматическое обнаружение провайдеров |
| `/providers` | Статус провайдеров с тестом коннективности |
| `/providers test` | Пинг всех провайдеров (latency) |
| `/cost` | Статистика стоимости (today/week/month) |
| `/remember <key> <value>` | Сохранить факт в память |
| `/recall <key>` | Найти в памяти |
| `/forget <key>` | Удалить из памяти |
| `/memories` | Список всех сохранённых фактов |
| `/run <task>` | Запустить фоновую AI-задачу |
| `/jobs` | Список фоновых задач |
| `/job <id>` | Результат фоновой задачи |
| `/hooks` | Управление хуками (26 типов событий) |
| `/memory` | Редактировать CLAUDE.md файлы |
| `/status` | Текущая сессия и провайдер |

### Hook System

FreeClaude includes 5 pre-configured safety hooks:

- 🛡️ `prevent-secret-commit` — warns before committing .env/credentials
- 🗑️ `prevent-rm-without-trash` — blocks `rm -rf`, suggests `trash`
- ✨ `auto-format-check` — suggests formatting after code edits
- 📝 `git-commit-tracker` — tracks AI commits for `/undo`
- ⏰ `long-task-notify` — notifications for slow tasks

### MCP Servers

**CEOClaw PM** (6 tools):
`pm_project_create`, `pm_project_list`, `pm_task_create`, `pm_task_update`, `pm_evm`, `pm_status`

**1С OData** (5 tools):
`odata_list_entities`, `odata_query`, `odata_count`, `odata_metadata`, `odata_financial_summary`

### Сравнение с конкурентами

| Фича | FreeClaude | Claude Code | Cline | Aider | OpenWork |
|-------|-----------|-------------|-------|-------|----------|
| Цена | 🆓 Free | $20/мес | Free | Free | Free |
| Fallback Chain | ✅ | ❌ | ❌ | ❌ | ❌ |
| Semantic Memory | ✅ GBrain | ❌ | ❌ | ❌ | Obsidian |
| Voice Mode | ✅ | 🔒 Paid | ❌ | ❌ | ✅ |
| PM Tools | ✅ MCP | ❌ | ❌ | ❌ | ❌ |
| 1С Integration | ✅ MCP | ❌ | ❌ | ❌ | ❌ |
| Hooks | ✅ 5 built-in | ✅ | ❌ | ❌ | ❌ |
| Russian Locale | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 🇬🇧 English

### Quick Start

```bash
git clone https://github.com/alexgrebeshok-coder/freeclaude.git
cd freeclaude
bun install && bun run build
cp .freeclaude.example.json ~/.freeclaude.json
node dist/cli.mjs
```

### Config (`~/.freeclaude.json`)

```json
{
  "providers": [
    {
      "name": "zai",
      "baseUrl": "https://api.z.ai/api/coding/paas/v4",
      "apiKey": "your-key",
      "model": "glm-4.7-flash",
      "priority": 1,
      "timeout": 30000
    }
  ]
}
```

### Free Providers (No API Key Needed)

- **ZAI (GLM-4.7-Flash)** — [Get API Key](https://open.bigmodel.cn/)
- **Ollama (Local)** — `ollama pull qwen2.5:3b`
- **Google Gemini** — [Get API Key](https://aistudio.google.com/)

---

## 📄 License

MIT — use freely, contribute welcome.

---

<div align="center">

**Made with 🐾 by FreeClaude contributors**

</div>
