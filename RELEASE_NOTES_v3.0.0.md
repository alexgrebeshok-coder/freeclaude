# FreeClaude v3.0.0 — Release Notes

> **Claude Code без авторизации. Бесплатно. С любыми моделями.**

---

## 🇷🇺 Русский

FreeClaude — форк Claude Code, который не требует OAuth, аккаунта Anthropic или подписки. Работает с любым OpenAI-compatible провайдером: от бесплатных ZAI и Gemini до локальных Ollama и LM Studio.

### Что нового по сравнению с v1

**🔄 Multi-Provider Fallback Chain**
- Автоматическое переключение между провайдерами при ошибках (429, 500, 502, 503, 504)
- Умный retry с exponential backoff
- Mark-down/cooldown: после 3 ошибок подряд провайдер «отдыхает» 5 минут

**⚡ /model — мгновенное переключение провайдеров**
- `/model` — список всех провайдеров с текущим выделенным
- `/model 1` — переключить по номеру
- `/model glm-5` — переключить по имени модели
- `/model ` (с пробелом) — интерактивный popup-меню со стрелками ↑↓
- Переключение мгновенное — не нужно перезапускать REPL
- Запоминание — выбранная модель сохраняется в `~/.freeclaude.json`

**🦀 /setup — управление провайдерами прямо в REPL**
- `/setup zai` — быстрое добавление ZAI (ключ из env)
- `/setup qwen <key>` — Qwen/DashScope
- `/setup ollama` — локальный Ollama (без ключа)
- `/setup free` / `/setup local` / `/setup paid` — просмотр по категориям
- `/setup add N [key]` — добавить по номеру
- `/setup remove N` — удалить провайдера

**📦 19 провайдеров из коробки**
- Бесплатные: ZAI (GLM-5), Google Gemini, Groq, Cerebras, Qwen, SambaNova, SiliconFlow
- Локальные: Ollama, LM Studio
- Платные: OpenAI, DeepSeek, Mistral
- Роутеры: OpenRouter, Together AI, Fireworks, DeepInfra

**🏗️ Desktop App (Tauri)** — нативное приложение для macOS/Linux/Windows

**💻 VS Code Extension** — чат, объяснение кода, исправление ошибок прямо в редакторе

**🧠 Session Memory** — `/remember`, `/recall`, `/forget`, `/memories` — персистентная память между сессиями

**💰 Cost Tracking** — `/cost` — статистика расходов за today/week/month

**🏃 Background Agents** — `/run <task>`, `/jobs`, `/job <id>` — фоновые AI-задачи

**🔌 MCP Servers**
- CEOClaw PM (6 инструментов) — управление проектами, EVM метрики
- 1С OData (5 инструментов) — доступ к данным 1С:Предприятие

**🎙️ Voice Mode** — Whisper STT + Edge TTS (бесплатно, локально)

**🪝 Hook System** — 26 типов событий, 5 предустановленных хуков

**🔧 Другие команды** — `/commit`, `/undo`, `/repo-map`, `/diff`, `/providers test`

**🐳 Docker & npm** — контейнер и пакет для глобальной установки

### Установка

```bash
git clone https://github.com/alexgrebeshok-coder/freeclaude.git
cd freeclaude
bun install && bun run build
node dist/cli.mjs
```

### Сравнение с конкурентами

| Фича | FreeClaude | Claude Code | Cline | Aider |
|-------|-----------|-------------|-------|-------|
| **Цена** | 🆓 Free | $20/мес | Free | Free |
| Fallback Chain | ✅ | ❌ | ❌ | ❌ |
| Провайдеры | 19 | 1 | 1 | 1 |
| Session Memory | ✅ | ❌ | ❌ | ❌ |
| Voice Mode | ✅ | 🔒 Paid | ❌ | ❌ |
| PM Tools | ✅ | ❌ | ❌ | ❌ |
| 1С Integration | ✅ | ❌ | ❌ | ❌ |
| Desktop App | ✅ | ❌ | ❌ | ❌ |
| Russian Locale | ✅ | ❌ | ❌ | ❌ |
| Cost Tracking | ✅ | ❌ | ❌ | ❌ |

### Метрики

- 392K+ строк кода
- 70 тестов — все pass
- 12+ slash-команд
- 26 hook-типов
- MIT License

---
---

## 🇬🇧 English

FreeClaude is a fork of Claude Code that doesn't require OAuth, an Anthropic account, or a subscription. Works with any OpenAI-compatible provider — from free ZAI and Gemini to local Ollama and LM Studio.

### What's New vs v1

**🔄 Multi-Provider Fallback Chain**
- Automatic provider switching on errors (429, 500, 502, 503, 504)
- Smart retry with exponential backoff
- Mark-down/cooldown: 3 consecutive errors → provider rests for 5 minutes

**⚡ /model — Instant Provider Switching**
- `/model` — list all providers with current highlighted
- `/model 1` — switch by number
- `/model glm-5` — switch by model name
- `/model ` (with space) — interactive popup menu with ↑↓ arrows
- Switching is instant — no REPL restart needed
- Persists choice in `~/.freeclaude.json`

**🦀 /setup — Provider Management Inside REPL**
- `/setup zai` — quick-add ZAI (key from env)
- `/setup qwen <key>` — Qwen/DashScope
- `/setup ollama` — local Ollama (no key needed)
- `/setup free` / `/setup local` / `/setup paid` — browse by category
- `/setup add N [key]` — add by number
- `/setup remove N` — remove provider

**📦 19 Providers Out of the Box**
- Free: ZAI (GLM-5), Google Gemini, Groq, Cerebras, Qwen, SambaNova, SiliconFlow
- Local: Ollama, LM Studio
- Paid: OpenAI, DeepSeek, Mistral
- Routers: OpenRouter, Together AI, Fireworks, DeepInfra

**🏗️ Desktop App (Tauri)** — native app for macOS/Linux/Windows

**💻 VS Code Extension** — chat, code explanation, error fixing right in the editor

**🧠 Session Memory** — `/remember`, `/recall`, `/forget`, `/memories` — persistent across sessions

**💰 Cost Tracking** — `/cost` — spending stats for today/week/month

**🏃 Background Agents** — `/run <task>`, `/jobs`, `/job <id>` — async AI tasks

**🔌 MCP Servers**
- CEOClaw PM (6 tools) — project management, EVM metrics
- 1С OData (5 tools) — read-only access to 1C:Enterprise data

**🎙️ Voice Mode** — Whisper STT + Edge TTS (free, local)

**🪝 Hook System** — 26 event types, 5 pre-configured hooks

**🔧 Other Commands** — `/commit`, `/undo`, `/repo-map`, `/diff`, `/providers test`

**🐳 Docker & npm** — containerized and global install

### Installation

```bash
git clone https://github.com/alexgrebeshok-coder/freeclaude.git
cd freeclaude
bun install && bun run build
node dist/cli.mjs
```

### Comparison

| Feature | FreeClaude | Claude Code | Cline | Aider |
|---------|-----------|-------------|-------|-------|
| **Price** | 🆓 Free | $20/mo | Free | Free |
| Fallback Chain | ✅ | ❌ | ❌ | ❌ |
| Providers | 19 | 1 | 1 | 1 |
| Session Memory | ✅ | ❌ | ❌ | ❌ |
| Voice Mode | ✅ | 🔒 Paid | ❌ | ❌ |
| PM Tools | ✅ | ❌ | ❌ | ❌ |
| 1C Integration | ✅ | ❌ | ❌ | ❌ |
| Desktop App | ✅ | ❌ | ❌ | ❌ |
| Cost Tracking | ✅ | ❌ | ❌ | ❌ |

### Metrics

- 392K+ lines of code
- 70 tests — all pass
- 12+ slash commands
- 26 hook types
- MIT License

---
---

## 🇨🇳 中文

FreeClaude 是 Claude Code 的开源分支，无需 OAuth、Anthropic 账户或订阅。支持任何 OpenAI 兼容的提供商——从免费的 ZAI 和 Gemini 到本地的 Ollama 和 LM Studio。

### 相比 v1 的新功能

**🔄 多提供商故障转移链**
- 错误时自动切换提供商（429、500、502、503、504）
- 智能重试与指数退避
- 标记降级/冷却：连续 3 次错误后，提供商休息 5 分钟

**⚡ /model — 即时切换提供商**
- `/model` — 列出所有提供商，高亮当前选项
- `/model 1` — 按编号切换
- `/model glm-5` — 按模型名称切换
- `/model `（带空格）— 带 ↑↓ 箭头的交互式弹出菜单
- 即时切换——无需重启 REPL
- 选择保存在 `~/.freeclaude.json`

**🦀 /setup — 在 REPL 内管理提供商**
- `/setup zai` — 快速添加 ZAI（从环境变量获取密钥）
- `/setup qwen <key>` — Qwen/DashScope
- `/setup ollama` — 本地 Ollama（无需密钥）
- `/setup free` / `/setup local` / `/setup paid` — 按类别浏览
- `/setup add N [key]` — 按编号添加
- `/setup remove N` — 删除提供商

**📦 开箱即用 19 个提供商**
- 免费：ZAI（GLM-5）、Google Gemini、Groq、Cerebras、Qwen、SambaNova、SiliconFlow
- 本地：Ollama、LM Studio
- 付费：OpenAI、DeepSeek、Mistral
- 路由器：OpenRouter、Together AI、Fireworks、DeepInfra

**🏗️ 桌面应用（Tauri）** — 支持 macOS/Linux/Windows 的原生应用

**💻 VS Code 扩展** — 在编辑器中直接聊天、解释代码、修复错误

**🧠 会话记忆** — `/remember`、`/recall`、`/forget`、`/memories` — 跨会话持久化

**💰 费用追踪** — `/cost` — 今日/本周/本月的支出统计

**🏃 后台代理** — `/run <task>`、`/jobs`、`/job <id>` — 异步 AI 任务

**🔌 MCP 服务器**
- CEOClaw PM（6 个工具）— 项目管理、EVM 指标
- 1С OData（5 个工具）— 1C:Enterprise 数据只读访问

**🎙️ 语音模式** — Whisper STT + Edge TTS（免费、本地）

**🪝 Hook 系统** — 26 种事件类型，5 个预配置钩子

**🔧 其他命令** — `/commit`、`/undo`、`/repo-map`、`/diff`、`/providers test`

**🐳 Docker & npm** — 容器化和全局安装

### 安装

```bash
git clone https://github.com/alexgrebeshok-coder/freeclaude.git
cd freeclaude
bun install && bun run build
node dist/cli.mjs
```

### 对比

| 功能 | FreeClaude | Claude Code | Cline | Aider |
|------|-----------|-------------|-------|-------|
| **价格** | 🆓 免费 | $20/月 | 免费 | 免费 |
| 故障转移链 | ✅ | ❌ | ❌ | ❌ |
| 提供商 | 19 个 | 1 个 | 1 个 | 1 个 |
| 会话记忆 | ✅ | ❌ | ❌ | ❌ |
| 语音模式 | ✅ | 🔒 付费 | ❌ | ❌ |
| PM 工具 | ✅ | ❌ | ❌ | ❌ |
| 1C 集成 | ✅ | ❌ | ❌ | ❌ |
| 桌面应用 | ✅ | ❌ | ❌ | ❌ |
| 费用追踪 | ✅ | ❌ | ❌ | ❌ |

### 数据

- 392K+ 行代码
- 70 个测试 — 全部通过
- 12+ 个斜杠命令
- 26 种 hook 类型
- MIT 许可证

---

**Made with 🐾 by Alexander Grebeshok**
