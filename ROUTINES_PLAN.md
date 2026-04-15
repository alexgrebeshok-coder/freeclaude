# FreeClaude Routines — Implementation Plan

**Дата:** 15.04.2026
**Контекст:** Anthropic выпустила Claude Code Routines (schedule + API + GitHub webhooks). FreeClaude уже имеет частичную инфраструктуру — heartbeat, cron, subagent bridge. Цель — реализовать полноценную систему рутин, превосходящую Anthropic по возможностям (бесплатно, локально, multi-provider, мультиагентность).

---

## Что у Anthropic (бенчмарк)

| Возможность | Anthropic | FreeClaude сейчас |
|-------------|-----------|-------------------|
| **Scheduled routines** | ✅ hourly/daily/weekly | ⚠️ CronCreateTool (in-memory + durable) |
| **API trigger** | ✅ POST endpoint + bearer token | ❌ Нет |
| **GitHub webhooks** | ✅ PR/release events + filters | ❌ Нет |
| **Connectors (MCP)** | ✅ Slack, Linear, Google Drive | ⚠️ MCP Servers (CEOClaw PM, 1С OData) |
| **Cloud execution** | ✅ Anthropic infra | ⚠️ Local only |
| **Per-session branches** | ✅ claude/ prefix | ❌ Нет |
| **Run management** | ✅ Web UI | ⚠️ /heartbeat + task protocol |
| **Subagent per event** | ✅ One session per PR | ⚠️ agentBridge (stub) |
| **Free** | ❌ Pro/Max/Team/Enterprise | ✅ Бесплатно |

---

## Архитектура FreeClaude Routines

```
┌─────────────────────────────────────────────────────────┐
│                   /routine CLI                           │
│  /routine create  /routine list  /routine run            │
│  /routine delete  /routine update  /routine logs         │
└─────────────┬───────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────┐
│              Routine Engine                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐  │
│  │ Scheduler │  │ API Server│  │ Webhook Receiver      │  │
│  │ (cron)    │  │ (HTTP)    │  │ (GitHub events)       │  │
│  └─────┬────┘  └─────┬────┘  └──────────┬────────────┘  │
│        │              │                  │                │
│  ┌─────▼──────────────▼──────────────────▼────────────┐  │
│  │              Routine Runner                         │  │
│  │  1. Parse trigger payload                           │  │
│  │  2. Load routine config (prompt, repos, env)        │  │
│  │  3. Spawn subagent (via agentBridge)                │  │
│  │  4. Monitor + collect results                       │  │
│  │  5. Notify (console, file, optional webhook)        │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────┐
│              Subagent System (Stage 3)                   │
│  agentBridge + agentProtocol + memory (Stage 2)         │
│  Context engine (Stage 5) + heartbeat (Stage 4)         │
└─────────────────────────────────────────────────────────┘
```

---

## Use Cases (все варианты использования)

### 1. Scheduled Routines (расписание)

| Use Case | Описание | Пример промпта |
|----------|----------|----------------|
| **Backlog triage** | Нightly — новые issue → label → assign → summary | "Read issues opened since yesterday. Label by area, assign to team member based on git blame, post summary to stdout" |
| **Docs drift check** | Weekly — проверить актуальность документации | "Scan merged PRs this week. Flag docs referencing changed APIs. Open update PRs" |
| **Dependency audit** | Weekly — проверить устаревшие зависимости | "Check package.json for outdated/vulnerable deps. Create update PRs with changelinks" |
| **Nightly bug fix** | Nightly — взять топовый баг, попытаться пофиксить | "Read top-priority bug from GitHub Issues. Attempt fix. Open draft PR" |
| **Memory consolidation** | Daily — консолидация памяти | "Review today's vault entries. Consolidate duplicates. Update memory.json. Archive old entries" |
| **Cost report** | Daily — отчёт по расходам | "Summarize token usage across all providers. Show daily/weekly cost. Flag anomalies" |

### 2. API Routines (HTTP endpoint)

| Use Case | Описание | Пример |
|----------|----------|--------|
| **Alert triage** | Мониторинг → POST alert → Claude анализирует | Datadog/Prometheus alert → routine endpoint → triage summary + draft fix |
| **Deploy verification** | CD pipeline → POST → smoke checks | After deploy: run tests, check logs, post go/no-go |
| **Feedback resolution** | Feedback widget → POST → draft fix | User reports bug → routine opens session with context → drafts fix |
| **1С event handler** | 1С webhook → POST → analyse | OData change notification → routine analyses impact → updates CEOClaw |
| **Telegram bot trigger** | Bot command → POST → execute | /analyze → routine processes request → returns result |
| **CI failure triage** | GitHub Actions fail → POST → diagnose | Failed build → routine reads logs → finds root cause → opens issue |

### 3. GitHub Webhook Routines

| Use Case | Описание | Фильтры |
|----------|----------|---------|
| **PR auto-review** | На каждый PR — security/perf/style check | Event: pull_request.opened, Is draft: false |
| **Library port** | Merge PR → порт в другой SDK | Event: pull_request.closed, Is merged: true |
| **Auth module watch** | Любой PR в /auth → review + notify | Head branch contains "auth-provider" |
| **External contributor triage** | Fork PR → extra security review | From fork: true |
| **Release changelog** | Release → auto-generate changelog | Event: release.published |
| **Label-gated backport** | Label "needs-backport" → порт | Labels include "needs-backport" |

### 4. Multi-Agent Routines (FreeClaude unique)

| Use Case | Описание | Агенты |
|----------|----------|--------|
| **Parallel review** | Один агент ревьюит код, другой тесты, третий security | reviewer + tester + security |
| **Research + implement** | Один исследует проблему, другой имплементирует | researcher + coder |
| **Build + test + deploy** | Pipeline из 3 агентов | builder + tester + deployer |
| **Monitor + fix** | Heartbeat находит проблему → спавнит агента на фикс | heartbeat + fixer |

---

## Стадии реализации

### Stage 8: /routine CLI Command (LOW effort)

**Что:** Команда для управления рутинами
**Файлы:** `src/commands/routine/index.ts`, `src/commands/routine/routine.ts`

```
/routine create — интерактивное создание
/routine list — список всех рутин
/routine run <id> — запустить вручную
/routine delete <id> — удалить
/routine update <id> — обновить промпт/триггер
/routine logs <id> — логи запусков
/routine enable <id> — включить
/routine disable <id> — выключить
```

**Config format** (`~/.freeclaude/routines.json`):
```json
{
  "routines": [
    {
      "id": "rtn_001",
      "name": "Nightly bug fix",
      "prompt": "Read top-priority bug from GitHub Issues...",
      "provider": "zai",
      "model": "glm-5-turbo",
      "triggers": {
        "schedule": "0 2 * * *",
        "api": { "enabled": true, "token": "fc_tok_..." },
        "github": { "event": "pull_request.opened", "filters": {} }
      },
      "repos": ["alexgrebeshok-coder/freeclaude"],
      "env": {},
      "connectors": [],
      "maxRunsPerDay": 5,
      "createdAt": "2026-04-15T12:00:00Z",
      "lastRun": null,
      "enabled": true
    }
  ]
}
```

**Тесты:** 10+ (CRUD, validation, edge cases)

---

### Stage 9: Routine Scheduler (MEDIUM effort)

**Что:** Расписание рутин по cron + минимальный интервал 1 час
**Файлы:** `src/services/routine/scheduler.ts`, `src/services/routine/scheduler.test.ts`

**Логика:**
1. Загрузить `~/.freeclaude/routines.json` при старте
2. Parse cron expression → next run time
3. Каждую минуту проверять: есть ли routine, чей nextRun <= now?
4. Запустить routine runner
5. Записать run result в `~/.freeclaude/routine-runs/`
6. Проверить maxRunsPerDay — если превысил, skip + warning

**Интеграция с heartbeat:**
- Heartbeat проверяет status scheduler-а
- Если scheduler упал — перезапустить
- Если routine упал — retry 1 раз, потом warning

**Тесты:** 12+ (cron parsing, nextRun calculation, daily cap, retry, edge cases)

---

### Stage 10: API Trigger Server (MEDIUM effort)

**Что:** HTTP сервер для приёма POST-запросов → запуск рутины
**Файлы:** `src/services/routine/apiServer.ts`, `src/services/routine/apiServer.test.ts`

**Endpoint:**
```
POST /api/routine/<id>/fire
Authorization: Bearer <token>
Content-Type: application/json

{"text": "Sentry alert SEN-4521 fired. Stack trace: ..."}
```

**Response:**
```json
{
  "type": "routine_fire",
  "routine_id": "rtn_001",
  "session_id": "sess_abc123",
  "session_url": "file://~/.freeclaude/routine-runs/sess_abc123.json",
  "status": "started"
}
```

**Логика:**
1. Validate token
2. Load routine config
3. Append `text` payload to prompt context
4. Spawn subagent via agentBridge
5. Return session ID immediately (async execution)
6. Write results to routine-runs/

**Security:**
- Bearer token per routine
- Rate limiting (max 10 requests/minute per routine)
- Input sanitization (max 10KB payload)
- No shell execution from payload

**Порт:** По умолчанию `8471` (configurable в `~/.freeclaude/config.json`)

**Тесты:** 15+ (auth, rate limit, payload handling, error cases, concurrent requests)

---

### Stage 11: GitHub Webhook Receiver (MEDIUM effort)

**Что:** Приём GitHub webhook events → запуск рутины
**Файлы:** `src/services/routine/githubWebhook.ts`, `src/services/routine/githubWebhook.test.ts`

**Endpoint:**
```
POST /api/routine/<id>/webhook/github
X-GitHub-Event: pull_request
X-Hub-Signature-256: sha256=<hmac>

{...GitHub event payload...}
```

**Supported events:**
| Event | Actions |
|-------|---------|
| pull_request | opened, closed, synchronize, labeled, assigned |
| release | published, created, edited, deleted |
| issues | opened, closed, labeled, assigned |
| push | (to specific branches) |

**Filter logic:**
```typescript
interface GitHubFilter {
  author?: { op: 'equals' | 'contains' | 'regex', value: string }
  title?: { op: 'equals' | 'contains' | 'regex', value: string }
  body?: { op: 'equals' | 'contains' | 'regex', value: string }
  baseBranch?: { op: 'equals' | 'contains', value: string }
  headBranch?: { op: 'equals' | 'contains', value: string }
  labels?: { op: 'includes' | 'not_includes', value: string[] }
  isDraft?: boolean
  isMerged?: boolean
  fromFork?: boolean
}
```

**Session mapping:**
- Каждый matching event → отдельная сессия
- Session ID включает PR/Issue number для трассировки
- Результаты в `~/.freeclaude/routine-runs/<routine_id>-<event_type>-<number>.json`

**Setup command:**
```
/routine setup-github <id> — показывает URL для webhook + instructions
```

**Security:**
- HMAC-SHA256 signature verification (shared secret)
- Validate GitHub event structure
- Rate limiting (max 50 events/hour per routine)

**Тесты:** 18+ (event parsing, filter logic, signature verification, session creation)

---

### Stage 12: Routine Runner + Subagent Integration (MEDIUM effort)

**Что:** Единый runner, который запускает рутину через subagent system
**Файлы:** `src/services/routine/runner.ts`, `src/services/routine/runner.test.ts`

**Логика:**
```
runRoutine(routineId, triggerPayload?)
  1. Load routine config from routines.json
  2. Check: enabled? daily cap not exceeded? provider available?
  3. Prepare context:
     - System prompt + routine prompt
     - If API trigger: append payload text
     - If GitHub trigger: append event summary (PR title, author, diff stats)
     - If schedule: append "Scheduled run at <time>"
  4. Clone repos if specified (shallow clone, claude/ branch)
  5. Spawn subagent via agentBridge:
     - Provider: routine.provider
     - Model: routine.model
     - Tools: read, write, exec, search, git
  6. Monitor execution:
     - Timeout: configurable (default 10 min for scheduled, 30 min for webhook)
     - Heartbeat check every 30s
  7. Collect result:
     - Files changed
     - Commands executed
     - Output summary
  8. Post-processing:
     - Write run report to routine-runs/
     - Update lastRun timestamp
     - Notify user (console log / file / optional callback webhook)
```

**Branch management:**
```
git checkout -b claude/routine-<id>-<timestamp>
# ... subagent works ...
git add -A && git commit -m "routine: <name> — auto-generated"
# If routine config has autoPR: true → gh pr create
```

**Тесты:** 15+ (config loading, context prep, timeout, error handling, branch naming)

---

### Stage 13: Routine Runs UI + /routine logs (LOW effort)

**Что:** Просмотр результатов запусков
**Файлы:** `src/commands/routine/logs.ts`

```
/routine logs — список последних 20 запусков (всех рутин)
/routine logs <id> — логи конкретной рутины
/routine logs <id> --last 5 — последние 5 запусков
/routine logs <id> --failed — только failed
/routine logs <id> --watch — live follow
```

**Run report format** (`~/.freeclaude/routine-runs/<id>-<timestamp>.json`):
```json
{
  "routineId": "rtn_001",
  "sessionId": "sess_abc123",
  "trigger": "schedule",
  "triggerPayload": null,
  "startedAt": "2026-04-15T02:00:00Z",
  "completedAt": "2026-04-15T02:08:32Z",
  "durationMs": 512000,
  "status": "success",
  "provider": "zai",
  "model": "glm-5-turbo",
  "tokensUsed": 12450,
  "filesChanged": ["src/auth/provider.ts"],
  "commandsRun": ["npm test", "git commit"],
  "output": "Fixed auth-provider timeout issue...",
  "error": null
}
```

**Тесты:** 8+ (formatting, filtering, watch mode)

---

### Stage 14: Version Bump Automation (LOW effort)

**Что:** Скрипт, который синхронизирует версию по всем поверхностям
**Файлы:** `scripts/sync-version.ts`

```
npm run version:sync 3.1.1
→ Updates: package.json, README.md, desktop/package.json,
  desktop/src-tauri/tauri.conf.json, extension/package.json,
  dist/cli.mjs version string
```

**Интеграция с CI:**
- Run on every commit to main
- Fail build if versions mismatch
- Auto-fix with `npm run version:sync`

**Тесты:** 5+ (sync logic, mismatch detection, auto-fix)

---

## Предыдущие стадии (уже done)

| Stage | Что | Статус |
|-------|-----|--------|
| 0 | Version truth 3.0.7 | ✅ |
| 1 | /vault CLI | ✅ |
| 2 | 3-layer memory | ✅ |
| 3 | Subagent system | ✅ |
| 4 | Heartbeat service | ✅ |
| 5 | Context engine | ✅ |
| 7 | Task protocol TS | ✅ |

## Предыдущие TODO (deferred)

| Stage | Что | Статус |
|-------|-----|--------|
| s9-vault-decouple | Вынести vault из taskManager | ⏸ Deferred |
| s9-coordinator-runtime | Реальный runtime для coordinator | ⏸ Deferred |

---

## Priority Order

```
Stage 8:  /routine CLI           — LOW, базовый интерфейс
Stage 14: Version bump automation — LOW, раз уж фиксили версии
Stage 9:  Routine Scheduler       — MEDIUM, cron engine
Stage 12: Routine Runner          — MEDIUM, execution core
Stage 10: API Trigger Server      — MEDIUM, HTTP endpoint
Stage 11: GitHub Webhook Receiver — MEDIUM, GitHub events
Stage 13: /routine logs UI        — LOW, observability
```

---

## Зависимости

```
Stage 8 ──────────────────────────────────┐
                                          ▼
Stage 9 ──► Stage 12 ──► Stage 10 ──► Stage 11
                                          │
Stage 14 (independent)                     ▼
                                     Stage 13
```

Stages 8, 9, 14 можно делать параллельно.
Stages 10, 11 зависят от Stage 12 (runner).

---

## Отличия от Anthropic (FreeClaude advantages)

| Фича | Anthropic | FreeClaude |
|-------|-----------|------------|
| Цена | $20-200/мес | Бесплатно |
| Провайдеры | Только Claude | Любой (ZAI, Gemini, Ollama, OpenAI) |
| Локальность | Облако Anthropic | Локально, данные не уходят |
| Мультиагентность | 1 агент на рутину | N агентов на рутину |
| Memory | Нет | GBrain + vault + decay |
| Custom webhooks | Только GitHub | Любой (GitLab, Bitbucket, custom) |
| 1С integration | Нет | OData MCP Server |
| Offline | Нет | Да (если schedule trigger) |

---

## Estimated effort

| Stage | Effort | Files | Tests | Lines |
|-------|--------|-------|-------|-------|
| 8 (/routine CLI) | LOW | 3 | 10 | ~400 |
| 9 (Scheduler) | MEDIUM | 2 | 12 | ~500 |
| 10 (API Server) | MEDIUM | 2 | 15 | ~600 |
| 11 (GitHub Webhook) | MEDIUM | 2 | 18 | ~700 |
| 12 (Runner) | MEDIUM | 2 | 15 | ~550 |
| 13 (Logs UI) | LOW | 1 | 8 | ~250 |
| 14 (Version sync) | LOW | 1 | 5 | ~150 |
| **Total** | | **13** | **83** | **~3150** |

---

## Что НЕ делаем (out of scope)

1. **Cloud execution** — FreeClaude = local-first. Если нужен cloud → VPS + systemd
2. **Web UI** — CLI-first. Web dashboard = CEOClaw scope
3. **Connectors marketplace** — MCP уже есть, достаточно
4. **Per-session branch protection** — простое claude/ prefix достаточно
5. **Anthropic API compatibility** — мы не Anthropic, свой API формат
