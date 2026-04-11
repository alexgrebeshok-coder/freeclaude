# FreeClaude v3 — Стратегический отчёт по развитию

**Дата:** 12.04.2026
**Автор:** Клод (AI-ассистент)
**Исследование:** 7 источников, 40+ статей, deep analysis конкурентов

---

## 📊 Конкурентный ландшафт (апрель 2026)

| Инструмент | ⭐ Stars | Модель | Платформа | Цена | Уникальное |
|-----------|---------|--------|-----------|------|------------|
| **Claude Code** | Закрытый | Claude | CLI | $20-100/мес | Hooks, Auto Mode, MCP v2.1 |
| **OpenCode** | 122K | 75+ провайдеров | CLI/IDE/Desktop | Free (BYOK) | LSP, Go-бинарник, 75+ моделей |
| **Kilo** | — | 500+ моделей | VS Code/JetBrains/CLI | Free (BYOK) | Cloud Agents, 1.5M пользователей |
| **Aider** | 25K+ | Любой LLM | CLI | $10/мес | Git-native, repo-map, auto-lint |
| **Cline** | 5M+ пользователей | Любой LLM | VS Code | Free (BYOK) | Plan/Act modes, MCP |
| **Continue.dev** | 25K+ | Любой LLM | VS Code/JetBrains | Free | Inline editing, checkpoint |
| **Goose** (Block) | — | Любой LLM | CLI | Free | Extensible toolkit |
| **FreeClaude** | — | Любой OpenAI-compat | CLI | Free | Fallback chain, GBrain, Debug |
| **LiteLLM** | 15K+ | 100+ провайдеров | SDK/Proxy | Free | Load balancing, guardrails |

---

## 🔍 Глубинный анализ конкурентов

### Claude Code (v2.1.101) — ЧТО НОВОГО

**Ключевые фичи апреля 2026:**

1. **Hooks System** — 3 типа хуков:
   - `PreToolUse` — до выполнения инструмента (может defer/allow/deny)
   - `PermissionDenied` — после отказа auto-mode классификатора (retry)
   - `Stop` / `SubagentStop` — при остановке сессии/сабагента

2. **Auto Mode** (март 2026) — ML-классификатор разрешений:
   - Между "ask every time" и "--dangerously-skip-permissions"
   - Обучается на паттернах безопасных/опасных операций
   - Enterprise: managed policies

3. **Named Subagents** — @-mentions с typeahead
   - Сабагенты наследуют MCP tools
   - Isolated worktrees

4. **MCP v2.1** — Model Context Protocol:
   - Non-blocking mode
   - 10,000+ публичных серверов
   - 97M monthly SDK downloads

5. **Monitor Tool** — streaming events из background scripts

6. **Headless Batch Mode** (`--bare`):
   - Пропускает hooks, LSP, plugins
   - Для CI/CD и автоматизации

7. **Voice Mode** — голосовой ввод/вывод

8. **Computer Use** — удалённое управление рабочим столом

9. **LSP Integration** — clientInfo для language servers

10. **`/ultraplan`** — удалённые сессии с cloud environment

11. **W3C OTEL Tracing** — observability

12. **`/team-onboarding`** — генерация ramp-up guide из usage

### OpenCode (122K ⭐) — Главный open-source конкурент

**Архитектура:** Go-бинарник (единственный файл), MIT license
**Провайдеры:** 75+ (Claude, GPT, Gemini, Ollama, и любые OpenAI-compat)
**Интерфейсы:** Terminal TUI, Desktop app, IDE extension, Web

**Фичи:**
- LSP integration (автодополнение, diagnostics)
- MCP support (local + remote servers)
- Custom agents через `opencode agent create`
- Privacy-first (всё локально)
- Free built-in models (Gemini, Groq)

**Что можно взять:**
- Go-бинарник (portable, no runtime deps)
- LSP client
- Custom agents framework

### Aider — Git-native champion

**Фичи:**
- **Repo-map** — структурная карта репозитория (200K tokens context)
- **Auto git commits** с осмысленными сообщениями
- **Easy rollback** — каждое изменение в отдельном коммите
- **Auto-lint/test** — автоматически запускает lint и тесты
- **Voice coding** — голосовой ввод
- **Image/web context** — скриншоты и URL как контекст

**Что можно взять:**
- Repo-map algorithm (tree-sitter based)
- Auto-commit с AI-генерируемыми сообщениями
- Rollback system

### Kilo (OpenCode fork) — Enterprise direction

**Архитектура:** Decoupled — OpenCode server как backend, UI как клиент
**Фичи:**
- VS Code + JetBrains + CLI + Cloud Agents
- 500+ моделей из 30+ провайдеров
- Cloud Agents (24/7 background coding)
- 1.5M пользователей

**Что можно взять:**
- Decoupled architecture (server/client)
- Cloud agents concept

---

## 🎯 Анализ gaps FreeClaude v2

### ❌ Чего НЕТ (критичные gaps):

| Gap | Кто имеет | Влияние |
|-----|-----------|---------|
| **MCP Support** | Claude Code, OpenCode, Cline | 10K+ серверов инструментов |
| **Git Integration** | Aider (killer feature) | Auto-commit, rollback, repo-map |
| **Repo-map** | Aider, Claude Code | Понимание структуры кода |
| **Hooks System** | Claude Code | Custom pre/post processing |
| **Auto Mode** | Claude Code | Permission classifier |
| **IDE Integration** | Kilo, Continue, Cline | VS Code/JetBrains |
| **LSP** | OpenCode, Claude Code | Diagnostics, completions |
| **Plugin System** | Claude Code, Kilo | Extensibility |
| **Voice Mode** | Claude Code, Aider | Голосовой ввод |
| **Streaming/Background** | Claude Code, Kilo | 24/7 background coding |
| **Checkpoint/Undo** | Continue, Aider | Откат изменений |

### ✅ ЧТО УЖЕ ЕСТЬ (наше преимущество):

| Feature | FreeClaude | Конкуренты |
|---------|-----------|------------|
| **Fallback Chain** | ✅ Уникальное | LiteLLM (proxy), никто в CLI |
| **GBrain Memory** | ✅ Уникальное | Ни у кого |
| **Debug Agent** | ✅ Уникальное | Claude Code (trace), но не evidence-based |
| **Multi-provider** | ✅ | OpenCode (75+), Kilo (500+), LiteLLM (100+) |
| **Cost Calculator** | ✅ | LiteLLM (proxy mode) |
| **$0 operation** | ✅ | Aider ($10/мес), Claude ($20/мес) |

---

## 🚀 Roadmap FreeClaude v3 — Приоритеты

### Tier 1: KILLER (то, что сделает FreeClaaw уникальным)

#### 1.1 Git Integration + Repo-Map (Sprint 6)
**Вдохновение:** Aider
**Время:** 2-3 дня
**Что:**
- Auto-commit каждого AI-изменения с AI-генерируемыми сообщениями
- `/undo` — откат последнего изменения
- Repo-map: tree-sitter based карта репозитория
- `/diff` — показать что изменилось

**Почему критично:** Aider вырос до 25K+ ⭐ именно на этом. Git-native workflow = developer love.

**Код:**
```
fc "рефакторь авторизацию"
→ AI делает изменения
→ Auto-commit: "refactor: extract JWT validation into auth middleware"
→ fc undo  # откат если не понравилось
```

#### 1.2 MCP Client (Sprint 7)
**Вдохновение:** Claude Code v2.1, OpenCode
**Время:** 3-4 дня
**Что:**
- MCP v2.1 client (stdio + SSE)
- Конфиг: `~/.freeclaude-mcp.json`
- `fc mcp add <server>` / `fc mcp list`
- Доступ к 10,000+ MCP серверам (базы данных, GitHub, Jira, и т.д.)

**Почему критично:** MCP = стандарт индустрии (97M downloads/мес). Без MCP FreeClaude = изолированный инструмент.

**Код:**
```
fc mcp add github -- npx -y @anthropic/mcp-server-github
fc mcp add postgres -- npx -y @anthropic/mcp-server-postgres
fc "найди все открытые issues в CEOClaw"  # через MCP GitHub server
```

#### 1.3 Voice Mode (Sprint 8)
**Вдохновение:** Claude Code, Aider + наш опыт с OpenClaw
**Время:** 2 дня
**Что:**
- Whisper для speech-to-text (уже есть в OpenClaw)
- Edge TTS для text-to-speech (уже есть в OpenClaw)
- Push-to-talk в CLI
- Голосовое подтверждение операций

**Почему критично:** У нас ЕСТЬ весь код (Whisper + TTS из OpenClaw). Остолько обернуть. У конкурентов это либо платно, либо только в Claude Code.

**Код:**
```
fc --voice  # включить голосовой режим
🎤 "рефакторь авторизацию"  # говоришь
🔊 "Готово. Изменения в 3 файлах, закоммичено."  # слышишь
```

### Tier 2: IMPORTANT (для конкурентоспособности)

#### 2.1 Hooks System (Sprint 9)
**Вдохновение:** Claude Code hooks
**Время:** 3 дня
**Что:**
- `~/.freeclaude-hooks.json`
- PreToolUse: до выполнения команды (allow/deny/modify)
- PostToolUse: после выполнения (logging, notifications)
- PermissionDenied: retry логика
- Bash script хуки

**Примеры:**
```json
{
  "hooks": {
    "pre-tool-use": [{
      "matcher": "Bash(rm *)",
      "command": "echo '⚠️ DANGER: delete operation blocked'",
      "decision": "deny"
    }],
    "post-tool-use": [{
      "matcher": "*",
      "command": "notify-send 'FreeClaude' 'Task completed'"
    }]
  }
}
```

#### 2.2 LSP Integration (Sprint 10)
**Вдохновение:** OpenCode, Claude Code
**Время:** 4-5 дней
**Что:**
- LSP client для TypeScript, Python, Go
- Inline diagnostics (подсвечивает ошибки)
- Go-to-definition, find-references
- Кастомный completion provider

#### 2.3 Plugin System (Sprint 11)
**Вдохновение:** Claude Code plugins, Kilo
**Время:** 3-4 дня
**Что:**
- `~/.freeclaude/plugins/` — директория плагинов
- SKILL.md format (как OpenClaw)
- `fc plugin install <name>` / `fc plugin list`
- Community plugin registry

#### 2.4 Background Agents (Sprint 12)
**Вдохновение:** Claude Code /loop, Kilo Cloud Agents
**Время:** 3-4 дня
**Что:**
- `fc run --background "задача"` — запустить в фоне
- `fc jobs` — список фоновых задач
- `fc job <id> --output` — результат
- Heartbeat monitoring (из OpenClaw)

### Tier 3: NICE TO HAVE (дифференциация)

#### 3.1 Auto Mode (Permission Classifier)
**ML-классификатор:** безопасные операции (read, lint) vs опасные (rm, push)
**Вдохновение:** Claude Code Auto Mode

#### 3.2 `/ultraplan` — Remote Sessions
**Cloud environment** для выполнения задач

#### 3.3 Team Features
- `/team-onboarding` — генерация ramp-up guide
- Shared config для команды
- Usage analytics per developer

#### 3.4 IDE Extensions
- VS Code extension (VSIX)
- JetBrains plugin

#### 3.5 CI/CD Integration
- `--bare` mode (no hooks, no plugins)
- GitHub Actions integration
- PR review agent

---

## 🧠 Синергия с CEOClaw/OpenClaw

### Что можно взять ИЗ НАШЕГО стека:

| Feature | Где | Перенос в FreeClaude |
|---------|-----|---------------------|
| **Voice (Whisper + TTS)** | OpenClaw TOOLS.md | Sprint 8 (2 дня) |
| **Memory (GBrain)** | Уже в FreeClaude ✅ | — |
| **Telegram Bot** | OpenClaw/CEOClaw daemon | Sprint 13 — уведомления о задачах |
| **Cron/Heartbeat** | OpenClaw HEARTBEAT.md | Sprint 12 — background agents |
| **Browser Automation** | OpenClaw (Playwright) | Sprint 14 — MCP server для браузера |
| **1С Integration** | bazis_v2.py | Sprint 15 — MCP server для 1С OData |
| **Multi-agent** | OpenClaw sessions_spawn | Sprint 12 — subagent orchestration |
| **Debug Agent** | Уже в FreeClaude ✅ | — |

### CEOClaw как "Plugin" для FreeClaude:
```
FreeClaude (CLI agent)
  ├── MCP Server: CEOClaw PM (EVM, Gantt, 1С)
  ├── MCP Server: GBrain (semantic memory)
  ├── MCP Server: Browser (Playwright)
  └── MCP Server: Telegram (notifications)
```

---

## 📈 Позиционирование

### Уникальное значение FreeClaude:

> **Единственный бесплатный AI coding agent с:**
> 1. Multi-provider fallback (автопереключение)
> 2. Семантической памятью (GBrain)
> 3. Evidence-based debugging
> 4. Голосовым режимом (из коробки)
> 5. Русской локализацией
> 6. Enterprise интеграциями (1С, Telegram)

### Целевая аудитория:

1. **Инди-разработчики** — бесплатная альтернатива Cursor ($20/мес)
2. **Российские разработчики** — работает с ZAI, без VPN
3. **Enterprise PM** — через CEOClaw MCP plugin
4. **Open source сообщество** — форк-friendly, MIT license

### Конкурентные преимущества vs:

| vs Claude Code | vs OpenCode | vs Aider | vs Kilo |
|---------------|-------------|----------|---------|
| Free (no Anthropic) | Fallback chain | Git integration | Voice mode |
| Any provider | GBrain memory | Repo-map | 1С integration |
| Russian locale | Debug agent | $0 | Semantic memory |
| CEOClaw MCP | Voice (planned) | — | Russian locale |

---

## 🗓 Roadmap Timeline

```
Sprint 6 (3 дня)   → Git Integration + Repo-Map
Sprint 7 (4 дня)   → MCP Client
Sprint 8 (2 дня)   → Voice Mode
Sprint 9 (3 дня)   → Hooks System
Sprint 10 (5 дней) → LSP Integration
Sprint 11 (4 дня)  → Plugin System
Sprint 12 (4 дня)  → Background Agents
Sprint 13 (3 дня)  → Telegram Notifications
Sprint 14 (3 дня)  → Browser MCP Server
Sprint 15 (3 дня)  → 1С OData MCP Server

Итого: ~34 дня → FreeClaude v3 "Feature Complete"
```

### MVP v3.0 (Sprint 6-8, ~9 дней):
- Git + Repo-Map
- MCP Client
- Voice Mode

**Этого достаточно для анонса и привлечения early adopters.**

---

## 💡 Стратегические рекомендации

### 1. "Склад деталей" подход
Берём лучшее из каждого:
- **Aider:** repo-map, auto-commit
- **Claude Code:** hooks, MCP, auto-mode
- **OpenCode:** LSP, Go portability
- **Kilo:** cloud agents, decoupled architecture
- **LiteLLM:** load balancing, guardrails
- **OpenClaw:** voice, memory, multi-agent

### 2. MCP как стратегический рычаг
Каждый MCP server = фича. Вместо того чтобы писать всё сами:
- База данных → community MCP server
- GitHub → @anthropic/mcp-server-github
- 1С → наш MCP server (уникальное!)
- CEOClaw → наш MCP server (уникальное!)

### 3. Russian-first, global-second
- Русская локализация из коробки
- ZAI/GLM как дефолтный бесплатный провайдер
- Документация на RU + EN
- Telegram как основной канал (не Slack/Discord)

### 4. Open Source + Enterprise
- Core: MIT, полностью free
- Enterprise: CEOClaw plugin marketplace (будущее)
- Revenue: consulting, custom plugins, hosted version

---

## 🎯 Итог

**FreeClaude v2** = Claude Code fork с fallback + memory + debug
**FreeClaude v3** = полноценный AI coding agent с уникальными фичами, которых нет ни у одного конкурента

**Ключевое отличие:** мы не клонируем Claude Code — мы берём лучшее из ВСЕХ инструментов и комбинируем с нашим уникальным стеком (GBrain, CEOClaw, 1С, voice).

**Next step:** Sprint 6 (Git Integration) — самый быстрый path к "wow effect".
