<div align="center">

# 🆓 FreeClaude v2

**Бесплатный Claude Code для всех — с Fallback Chain, GBrain и Debug Agent**

Форк [OpenClaude](https://github.com/openclaw/openclaw) без OAuth авторизации. Работает с любыми OpenAI-compatible API провайдерами.

[![Sprint Status](https://img.shields.io/badge/5%2F5%20Sprints-Done-brightgreen)](https://github.com/alexgrebeshok-coder/freeclaude)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

[English](#english) · [Русский](#русский)

</div>

---

## 🇷🇺 Русский

### Что нового в v2

| Спринт | Фича | Статус |
|--------|-------|--------|
| 1 | 🔗 **Fallback Chain** — автопереключение провайдеров | ✅ |
| 2 | 📊 **Token Counter + Cost Calculator** — учёт использования | ✅ |
| 3 | 🔧 **Provider Wizard** — настройка за 1 минуту | ✅ |
| 4 | 🧠 **GBrain Integration** — семантическая память | ✅ |
| 5 | 🐛 **Debug Agent** — evidence-based дебаггинг | ✅ |

### Быстрый старт

```bash
# 1. Клонируем и собираем
git clone https://github.com/alexgrebeshok-coder/freeclaude.git
cd freeclaude
bun install && bun run build

# 2. Настраиваем провайдеров (интерактивный визард)
bun run src/commands/setup.ts

# Или вручную — копируем конфиг
cp .freeclaude.example.json ~/.freeclaude.json
# Редактируем ~/.freeclaude.json

# 3. Работаем!
node dist/cli.mjs -p "Создай REST API для TODO-листа"
```

### Поддерживаемые провайдеры

| Провайдер | Цена | Модель | Статус |
|-----------|------|--------|--------|
| 🇷🇺 **ZAI (GLM)** | Бесплатно | glm-4.7-flash | ✅ |
| 🏠 **Ollama** | Бесплатно | qwen2.5:3b, llama3 | ✅ |
| 🌐 **Google Gemini** | 15 RPM бесплатно | gemini-2.5-flash-lite | ✅ |
| 💰 **OpenAI** | $2.50/1M tokens | gpt-4o | ✅ |
| 💰 **DeepSeek** | $0.14/1M tokens | deepseek-chat | ✅ |
| 🔧 **Любой OpenAI-compatible** | — | любая | ✅ |

### Fallback Chain

Автоматическое переключение между провайдерами при ошибках:

```
fc "напиши код"
  → ZAI (priority 1) → 401/429/5xx
  → Ollama (priority 2) → ✅ ответ
  → Gemini (priority 3) → если Ollama тоже упал
```

**Фичи:**
- Автопереключение на 401, 429, 500, 502, 503, 504
- Cooldown: 3 ошибки подряд → 5 мин пауза → авто-восстановление
- Logging: `[FreeClaude] 374 tokens | ollama | $0.0000 (fallback)`

### Token Counter + Cost Calculator

```bash
# Посмотреть статистику за 7 дней
fc stats 7
```

```
FreeClaude Usage (7 days)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Provider     | Requests | Tokens   | Cost
ollama       |       42 |   15.2K | $0.0000
zai          |       18 |    8.7K | $0.0000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL        |       60 |   23.9K | $0.0000
```

### Provider Wizard

```bash
fc setup
```

Интерактивная настройка:
- 6 пресетов (ZAI, Ollama, Gemini, OpenAI, DeepSeek, Custom)
- Автоматический тест соединения
- Управление приоритетами

### GBrain Integration

Автоматическое обогащение промптов релевантным контекстом из базы знаний:

```
Пользователь: "Опиши архитектуру CEOClaw"
→ GBrain находит 5 релевантных документов
→ Контекст добавляется в system prompt
→ LLM отвечает с учётом контекста
```

Требует: [GBrain](https://github.com/garrytan/gbrain) + Ollama с nomic-embed-text.

### Debug Agent

Evidence-based дебаггинг:

```bash
fc debug "API возвращает 500 на POST /users" --file src/api.ts
```

```
🐛 Debug Session: a1b2c3d4
Hypotheses:
  ⏳ Unhandled exception in call stack (80%)
  ⏳ Null/undefined reference (75%)

📋 Suggested instrumentation points:
  Line 42: createUser
  Line 58: return_value
  Line 72: error_caught
```

### Конфигурация

`~/.freeclaude.json`:
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
    },
    {
      "name": "ollama",
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama",
      "model": "qwen2.5:3b",
      "priority": 2,
      "timeout": 30000
    }
  ],
  "defaults": {
    "maxRetries": 3,
    "retryDelay": 500,
    "logLevel": "info"
  }
}
```

### Архитектура

```
freeclaude/
├── src/
│   ├── services/
│   │   ├── api/
│   │   │   ├── fallbackChain.ts    # 🔗 Fallback chain (Sprint 1)
│   │   │   ├── openaiShim.ts       # OpenAI compatibility layer
│   │   │   └── providerConfig.ts   # Provider resolution
│   │   ├── usage/
│   │   │   ├── tokenCounter.ts     # 📊 Token estimation
│   │   │   ├── costCalculator.ts   # 💰 Per-provider pricing
│   │   │   └── usageStore.ts       # 📈 NDJSON persistence
│   │   ├── memory/
│   │   │   ├── gbrainClient.ts     # 🧠 GBrain CLI wrapper
│   │   │   └── contextEnricher.ts  # 📝 Prompt enrichment
│   │   └── debug/
│   │       └── debugAgent.ts       # 🐛 Evidence-based debugging
│   ├── commands/
│   │   ├── setup.ts                # 🔧 Provider wizard
│   │   ├── stats.ts                # 📊 Usage statistics
│   │   └── debug.ts                # 🐛 Debug CLI
│   └── entrypoints/
│       └── cli.tsx                 # Main CLI entry
├── .freeclaude.example.json        # Config template
└── FREECLAUDE_V2_PLAN.md           # Development plan
```

---

## English

### What's New in v2

FreeClaude v2 adds 5 major features on top of the OpenClaude fork:

| Sprint | Feature | Description |
|--------|---------|-------------|
| 1 | 🔗 **Fallback Chain** | Auto-switch between providers on 401/429/5xx |
| 2 | 📊 **Token Counter** | Track token usage and costs per provider |
| 3 | 🔧 **Provider Wizard** | Interactive setup in under 1 minute |
| 4 | 🧠 **GBrain Memory** | Semantic search enriches prompts automatically |
| 5 | 🐛 **Debug Agent** | Hypothesis-driven debugging with instrumentation |

### Quick Start

```bash
git clone https://github.com/alexgrebeshok-coder/freeclaude.git
cd freeclaude
bun install && bun run build

# Interactive setup
bun run src/commands/setup.ts

# Or manual: copy and edit config
cp .freeclaude.example.json ~/.freeclaude.json

# Use
node dist/cli.mjs -p "Build a REST API for a todo list"
```

### Supported Providers

All OpenAI-compatible APIs. Free options: **ZAI** (GLM, Russia), **Ollama** (local), **Gemini** (15 RPM free tier).

### Commands

```bash
fc "your task"                    # Use with fallback chain
fc setup                          # Configure providers
fc stats [days]                   # View usage statistics
fc debug "bug description" -f file.ts  # Debug with hypotheses
```

---

## License

MIT

---

<div align="center">

**Built with ❤️ by the CEOClaw team**

Free AI tools for everyone — no subscriptions, no API keys required (with local models)

</div>
