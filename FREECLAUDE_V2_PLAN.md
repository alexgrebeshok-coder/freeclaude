# FreeClaude v2 — План развития

**Дата:** 12.04.2026
**Проект:** `~/.openclaw/workspace/freeclaude/`
**Статус:** Core работает (6/6 тестов), Ollama подключена
**Цель:** Бесплатный Claude Code для всех — zero cost, любой язык, локально + облако

---

## 📊 Текущий статус

### ✅ Что работает
- Core CLI (codex/claude style, интерактивный + print mode)
- Shell команды, файловые операции, subagents
- Web search, MCP support, context management
- Ollama (qwen2.5:3b) — проверено 11.04, ответ корректный
- ZAI (glm-4.7-flash) — работает, но rate limited

### ❌ Что не реализовано
- Fallback chain (автопереключение провайдеров)
- Token counter / Cost calculator
- Provider config file (~/.freeclaude.json)
- Provider wizard (интерактивная настройка)
- Интеграция с GBrain (память/контекст)

---

## 🗺️ Roadmap FreeClaude v2

### Sprint 1: Fallback Chain (3 дня)

**Цель:** Автоматическое переключение между провайдерами при ошибках

**Архитектура:**
```
Запрос → Provider #1 (ZAI)
  ├─ 200 OK → ответ пользователю
  ├─ 429 Rate Limit → Provider #2 (Ollama)
  │   ├─ 200 OK → ответ
  │   └─ ошибка → Provider #3 (Gemini)
  └─ 401/5xx → Provider #2 (Ollama)
```

**Файлы для изменения:**
1. `src/services/api/providerConfig.ts`
   - Новый тип `ProviderConfig[]` — список провайдеров
   - Функция `loadProviderChain()` — читает из `~/.freeclaude.json`
   - Функция `getNextProvider(currentIndex)` — возвращает следующий

2. `src/services/api/openaiShim.ts`
   - Обернуть `createOpenAIShimClient` в retry loop
   - При 401/429/5xx → вызов `getNextProvider()`
   - Логировать переключение: `[FreeClaude] ZAI rate limited → Ollama`

3. **Новый:** `~/.freeclaude.json` (конфиг провайдеров)
```json
{
  "providers": [
    {
      "name": "zai",
      "baseUrl": "https://api.z.ai/api/coding/paas/v4",
      "apiKey": "env:ZAI_API_KEY",
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
      "timeout": 60000
    },
    {
      "name": "gemini",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
      "apiKey": "env:GEMINI_API_KEY",
      "model": "gemini-2.5-flash-lite",
      "priority": 3,
      "timeout": 30000
    }
  ],
  "defaults": {
    "maxRetries": 3,
    "retryDelay": 1000,
    "logLevel": "info"
  }
}
```

4. **Новый:** `src/services/api/fallbackChain.ts`
   - Класс `FallbackChain` с методами:
     - `tryRequest(prompt)` → пробует провайдеры по порядку
     - `markDown(provider)` → временно понижает приоритет
     - `markUp(provider)` → восстанавливает приоритет
     - `getStatus()` → статистика переключений

**Критерии готовности:**
- [ ] `fc -p "test"` работает через ZAI
- [ ] При rate limit ZAI → автоматический переход на Ollama
- [ ] Лог: `[FreeClaude] Switched to ollama (zai: 429 rate limit)`
- [ ] Конфиг читается из `~/.freeclaude.json`
- [ ] Все существующие тесты проходят

---

### Sprint 2: Token Counter + Cost Calculator (2 дня)

**Цель:** Отслеживать расход токенов и стоимость по каждому провайдеру

**Формат вывода после каждого ответа:**
```
[FreeClaude] 245 tokens (prompt: 180, completion: 65) | ollama | $0.00
```

**Команда `fc stats`:**
```
FreeClaude Usage (7 days)
━━━━━━━━━━━━━━━━━━━━━━━━━━
Provider     | Requests | Tokens   | Cost
ollama       | 142      | 45,200   | $0.00
zai          | 38       | 12,400   | $0.00
gemini       | 5        | 1,800    | $0.00
━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL        | 185      | 59,400   | $0.00
```

**Файлы:**
- `src/services/usage/tokenCounter.ts` — подсчёт токенов
- `src/services/usage/costCalculator.ts` — расчёт стоимости
- `src/services/usage/usageStore.ts` — хранение в `~/.freeclaude-usage.json`
- `src/commands/stats.ts` — команда `fc stats`

---

### Sprint 3: Provider Wizard (1 день)

**Цель:** Настроить нового провайдера за 1 минуту

**Команда:** `fc setup`
- Интерактивный prompt (readline)
- Тест подключения после настройки
- Запись в `~/.freeclaude.json`

**Файл:** `src/commands/setup.ts`

---

### Sprint 4: GBrain Integration (3 дня)

**Цель:** FreeClaude использует GBrain как долгосрочную память

```
User: "fc refactor auth module"
  → GBrain: "auth module использует JWT, файл auth.ts..."
  → FreeClaude: с контекстом делает рефакторинг
  → После завершения: результат → GBrain
```

**Файлы:**
- `src/services/memory/gbrainClient.ts` — CLI wrapper
- `src/services/memory/contextEnricher.ts` — обогащение system prompt

---

### Sprint 5: Debug Agent Integration (2 дня)

**Цель:** Встроенный evidence-based debugging

```
fc debug "описание бага"
  → Генерирует 3-5 гипотез
  → Инструментирует код NDJSON-логами
  → Анализирует логи → CONFIRMED/REJECTED
  → Фиксит с доказательствами
```

**Файл:** `src/services/debug/debugAgent.ts`
**Источник:** `github.com/millionco/debug-agent`

---

## 📅 Таймлайн

| Sprint | Длительность | Что | Старт |
|--------|-------------|-----|-------|
| 1 | 3 дня | Fallback Chain | 12.04 |
| 2 | 2 дня | Token Counter + Cost | 15.04 |
| 3 | 1 день | Provider Wizard | 17.04 |
| 4 | 3 дня | GBrain Integration | 18.04 |
| 5 | 2 дня | Debug Agent | 21.04 |

**Итого:** ~11 дней → FreeClaude v2 ready

---

## 🔧 Технические заметки

### Бесплатные провайдеры (zero cost)

| # | Провайдер | Модель | Статус |
|---|---|---|---|
| 1 | ZAI | glm-4.7-flash | ✅ Rate limited |
| 2 | Ollama | qwen2.5:3b | ✅ Работает |
| 3 | Gemini | gemini-2.5-flash-lite | ⏸️ Нужен API key |

### НЕ использовать
- ❌ OpenRouter — денег нет
- ❌ DeepSeek — нужен платный API key
- ❌ OpenAI — дорого

### Зависимости
- Ollama: ✅ установлен (qwen2.5:3b, nomic-embed-text-v2-moe)
- GBrain: ✅ установлен (878 страниц)
- Bun: ✅ установлен

### Связь с CEOClaw
- FreeClaude = CLI инструмент (для разработчиков)
- CEOClaw = Enterprise продукт (для бизнеса)
- Общее: GBrain, Debug Agent, Provider Router

---

*Подготовлено: Клод 🐾 | 11.04.2026 22:35*
