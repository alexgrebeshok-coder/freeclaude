<div align="center">

# 🆓 FreeClaude v3

**Local-first AI coding workspace — multi-provider, memory, voice, MCP**

Fork of Claude Code without OAuth lock-in. Works with any OpenAI-compatible provider.

[![v3.2.1](https://img.shields.io/badge/version-3.2.1-brightgreen)](https://github.com/alexgrebeshok-coder/freeclaude/releases)
[![CI](https://img.shields.io/badge/CI-smoke%20%2B%20tests-brightgreen)](https://github.com/alexgrebeshok-coder/freeclaude/actions)
[![Desktop](https://img.shields.io/badge/Desktop-Concept-lightgrey)](https://github.com/alexgrebeshok-coder/freeclaude/tree/main/desktop)
[![VS Code](https://img.shields.io/badge/VS%20Code-Concept-lightgrey)](https://github.com/alexgrebeshok-coder/freeclaude/tree/main/extension)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

[English](#english) · [Русский](#русский)

</div>

---

## 🇷🇺 Русский

### Статус поверхностей

| Поверхность | Статус | Описание |
|-------------|--------|----------|
| **CLI** | ✅ Primary | Основная рабочая поверхность |
| **Multi-provider** | ✅ Stable | ZAI, Ollama, Gemini, DeepSeek, OpenAI-compat + fallback |
| **Voice** | 🧪 Beta | Whisper STT через SoX, требует `brew install sox whisper-cpp` |
| **Task protocol** | 🔧 Prototype | `freeclaude task run/list/cancel --json` |
| **Desktop** | 💡 Concept | Дизайн-прототип, не собирается и не запускается |
| **VS Code extension** | 💡 Concept | Stub, не опубликован |
| **Memory vault** | 🔧 Prototype | Task protocol пишет Markdown notes в `~/.freeclaude/vault/`, но отдельного UI ещё нет |
| **Bridge / remote / CCR** | ⛔ Inherited | Anthropic-specific, не поддерживается в этом цикле |

### Engineering truth

- `bun run smoke` — текущая runtime-проверка для основного CLI-пути
- `npm run typecheck:supported` — текущий зелёный typecheck gate для поддерживаемых FreeClaude runtime surfaces
- `npm run typecheck:desktop-extension` — отдельный typecheck для desktop + extension concept surfaces
- Глобальный `npm run typecheck` пока включает inherited paths и ещё не является зелёным release gate

### Что нового в v3

- 🔄 **Multi-Provider Fallback** — автоматическое переключение между ZAI, Ollama, Gemini и другими
- 🎙️ **Voice Mode (Beta)** — Whisper STT через SoX, локально и бесплатно
- 🧠 **GBrain Semantic Memory** — семантическая память через локальные embeddings
- 💰 **Cost Tracking** — `/cost` показывает расходы по провайдерам
- 🛡️ **Hooks** — 5 встроенных safety-хуков
- 🔧 **Task Protocol (Prototype)** — машинный `freeclaude task run/list/cancel --json`
- 🏗️ **MCP Servers** — CEOClaw PM + 1С OData

### Быстрый старт

```bash
# 1. Clone & build
git clone https://github.com/alexgrebeshok-coder/freeclaude.git
cd freeclaude
bun install && bun run build

# 2. Run guided setup
node dist/cli.mjs --setup

# 3. Start coding
node dist/cli.mjs

# 4. Inside FreeClaude
/doctor
/run summarize changed files
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

### Управление провайдерами и моделями

**Просмотр и переключение:**
```
/model                      — список всех провайдеров
/model 1                    — переключиться на провайдера #1
/model openrouter           — переключиться по имени
/model openrouter anthropic/claude-sonnet-4   — сменить модель внутри провайдера
```

**Добавление провайдеров:**
```
/setup                      — главное меню (категории и список)
/setup free                 — показать бесплатные провайдеры
/setup local                — локальные (Ollama, LM Studio)
/setup paid                 — платные (OpenAI, DeepSeek)
/setup router               — роутеры (OpenRouter — 200+ моделей)
/setup ollama               — быстрое добавление Ollama
/setup openrouter           — быстрое добавление OpenRouter (ключ из env)
/setup zai                  — быстрое добавление ZAI (ключ из env)
/setup add 2 API_KEY        — добавить провайдера #2 с ключом
/setup remove 2             — удалить провайдера #2
```

**Тест подключения:**
```
/providers test             — пинг всех провайдеров (latency)
```

### Бесплатные провайдеры

| Провайдер | Ключ | Регистрация | Скорость |
|-----------|------|-------------|----------|
| 🇷🇺 ZAI (GLM-5) | `ZAI_API_KEY` | [open.bigmodel.cn](https://open.bigmodel.cn/) | ~15с (reasoning) |
| 🇺🇸 Google Gemini | `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/apikey) | ~3с |
| ⚡ Groq | `GROQ_API_KEY` | [console.groq.com](https://console.groq.com/keys) | ~1с |
| 🚀 Cerebras | `CEREBRAS_API_KEY` | [cloud.cerebras.ai](https://cloud.cerebras.ai) | ~0.5с |
| 🇨🇳 Qwen/DashScope | `DASHSCOPE_API_KEY` | [dashscope.console.aliyun.com](https://dashscope.console.aliyun.com/) | ~3с |
| 🏠 Ollama (local) | Не нужен | `ollama pull qwen2.5:7b` | ~1-2с |
| 🔀 OpenRouter | `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai/keys) | зависит от модели |

**Как подключить (пример OpenRouter):**
```bash
# 1. Получить ключ на openrouter.ai/keys
# 2. Добавить в ~/.zshrc
echo 'export OPENROUTER_API_KEY=sk-or-твой-ключ' >> ~/.zshrc
source ~/.zshrc
# 3. В FreeClaude:
/setup openrouter
/model openrouter anthropic/claude-sonnet-4
```

### Slash Commands

| Команда | Описание |
|---------|----------|
| `/model` | Переключить провайдера/модель |
| `/setup` | Добавить/удалить провайдера |
| `/commit` | AI-коммит с анализом изменений |
| `/diff` | Просмотр незакоммиченных изменений |
| `/undo [N]` | Откат последних N коммитов (soft reset) |
| `/repo-map` | Обзор структуры репозитория |
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

### Task Protocol Preview

Machine-readable local task interface for desktop/backend orchestration:

```bash
freeclaude task list --json
freeclaude task run --json "summarize changed files"
freeclaude task resume --json <task-id>
freeclaude task cancel --json <task-id>
freeclaude task template list --json
freeclaude task template run --json summarize-changed-files
freeclaude task schedule run --json --every 60 --template summarize-changed-files
freeclaude task schedule list --json
freeclaude task schedule cancel --json <schedule-id>
```

Task metadata and structured events are written to flat files like `~/.freeclaude/tasks/<task-id>.json` and `~/.freeclaude/tasks/<task-id>.events.jsonl`.
Artifacts are written to files like `~/.freeclaude/artifacts/<task-id>.md` and `~/.freeclaude/artifacts/<task-id>.diff.patch`.
Vault task notes are written to `~/.freeclaude/vault/tasks/<task-id>.md`, and project rollups to `~/.freeclaude/vault/projects/<repo>.md`.

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

| Фича | FreeClaude | Claude Code | Cline | Aider |
|-------|-----------|-------------|-------|-------|
| Цена | 🆓 Free | $20/мес | Free | Free |
| Fallback Chain | ✅ | ❌ | ❌ | ❌ |
| Semantic Memory | ✅ GBrain | ❌ | ❌ | ❌ |
| Voice Mode | 🧪 Beta | 🔒 Paid | ❌ | ❌ |
| PM Tools | ✅ MCP | ❌ | ❌ | ❌ |
| Hooks | ✅ 5 built-in | ✅ | ❌ | ❌ |

### Upstream Sync

FreeClaude is a fork of [Anthropic Claude Code](https://github.com/anthropics/claude-code).

```bash
git remote add upstream https://github.com/anthropics/claude-code.git
git fetch upstream --no-tags
```

**Protected files** (never overwrite from upstream):
`scripts/build.ts`, `src/hooks/useVoiceEnabled.ts`, `src/voice/voiceModeEnabled.ts`,
`package.json`, `dist/cli.mjs`, `README.md`

**Merge strategy:** manual cherry-pick of relevant upstream changes.

---

## 🇬🇧 English

### Quick Start

```bash
git clone https://github.com/alexgrebeshok-coder/freeclaude.git
cd freeclaude
bun install && bun run build
node dist/cli.mjs --setup
node dist/cli.mjs
# then run /doctor and /run summarize changed files
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

### Task Protocol Preview

Machine-readable local task interface for desktop/backend orchestration:

```bash
freeclaude task list --json
freeclaude task run --json "summarize changed files"
freeclaude task resume --json <task-id>
freeclaude task cancel --json <task-id>
freeclaude task template list --json
freeclaude task template run --json summarize-changed-files
freeclaude task schedule run --json --every 60 --template summarize-changed-files
freeclaude task schedule list --json
freeclaude task schedule cancel --json <schedule-id>
```

Task metadata and structured events are written to flat files like `~/.freeclaude/tasks/<task-id>.json` and `~/.freeclaude/tasks/<task-id>.events.jsonl`.
Artifacts are written to files like `~/.freeclaude/artifacts/<task-id>.md` and `~/.freeclaude/artifacts/<task-id>.diff.patch`.
Vault task notes are written to `~/.freeclaude/vault/tasks/<task-id>.md`, and project rollups to `~/.freeclaude/vault/projects/<repo>.md`.

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
