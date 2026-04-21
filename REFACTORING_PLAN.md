# План рефакторинга FreeClaude

**Документ:** REFACTORING_PLAN.md  
**Создан:** 2026-04-21  
**Статус:** Планирование  
**Приоритет:** P0 — Критичный

---

## Содержание

1. [Фаза 1: main.tsx — Разделение монолита](#фаза-1-maintx--разделение-монолита)
2. [Фаза 2: Promise и Error Handling](#фаза-2-promise-и-error-handling)
3. [Фаза 3: Тестирование — Permissions](#фаза-3-тестирование--permissions)
4. [Фаза 4: TypeScript Strict Mode](#фаза-4-typescript-strict-mode)
5. [Фаза 5: Архитектура — DI и модули](#фаза-5-архитектура--di-и-модули)
6. [Фаза 6: Производительность](#фаза-6-производительность)
7. [Таймлайн и ресурсы](#таймлайн-и-ресурсы)

---

## Фаза 1: main.tsx — Разделение монолита

**Приоритет:** P0  
**Оценка времени:** 3-5 дней  
**Риски:** Сломать CLI entry point

### Текущее состояние

```
src/main.tsx (4671 строк, ~800KB)
├── CLI parsing (commander)
├── Feature flag initialization
├── Authentication (OAuth, API keys)
├── Telemetry setup
├── Session management
├── Command routing
└── Exit handling
```

### Целевая структура

```
src/
├── cli/
│   ├── index.ts          # Entry point, minimal
│   ├── parser.ts         # Commander setup
│   ├── commands/         # Individual commands
│   │   ├── index.ts
│   │   ├── chat.ts
│   │   ├── config.ts
│   │   └── version.ts
│   └── middleware/
│       ├── auth.ts       # Auth checks
│       ├── telemetry.ts  # Analytics setup
│       └── flags.ts      # Feature flags
├── bootstrap/
│   ├── index.ts          # App initialization
│   ├── state.ts          # Global state (существует)
│   └── lifecycle.ts      # Startup/shutdown
└── main.ts               # Новый entry point (~100 строк)
```

### Пошаговый план

#### Шаг 1.1: Создать структуру директорий

```bash
mkdir -p src/cli/commands src/cli/middleware src/bootstrap
```

#### Шаг 1.2: Вынести CLI parsing

**Создать:** `src/cli/parser.ts`

```typescript
// Было в main.tsx:70-300
// Стало:
import { Command as CommanderCommand } from '@commander-js/extra-typings'

export function createCLIParser(): CommanderCommand {
  const program = new CommanderCommand()
    .name('freeclaude')
    .version(getVersion())
    // ... все опции

  return program
}
```

#### Шаг 1.3: Вынести командные обработчики

**Создать:** `src/cli/commands/chat.ts`

```typescript
export async function handleChatCommand(options: ChatOptions): Promise<void> {
  // Логика из main.tsx:1500-2000
}
```

#### Шаг 1.4: Вынести bootstrap

**Создать:** `src/bootstrap/index.ts`

```typescript
export async function initializeApp(config: AppConfig): Promise<AppContext> {
  // Инициализация telemetry
  // Инициализация auth
  // Загрузка feature flags
  // ...
}
```

#### Шаг 1.5: Новый entry point

**Создать:** `src/main.ts` (заменит main.tsx)

```typescript
import { createCLIParser } from './cli/parser.js'
import { initializeApp } from './bootstrap/index.js'

async function main(): Promise<void> {
  const program = createCLIParser()
  const context = await initializeApp()

  program.action(async (options) => {
    await handleCommand(options, context)
  })

  await program.parseAsync()
}

main().catch(handleFatalError)
```

#### Шаг 1.6: Миграция поэтапно

1. Создать новые файлы
2. Скопировать функции без изменений
3. Обновить импорты
4. Запустить тесты (`npm run smoke`)
5. Удалить старый код из main.tsx

### Контрольные точки

- [ ] `npm run build` проходит
- [ ] `npm run smoke` проходит
- [ ] `freeclaude --version` работает
- [ ] `freeclaude --help` работает
- [ ] Базовый чат работает

---

## Фаза 2: Promise и Error Handling

**Приоритет:** P0  
**Оценка времени:** 1-2 дня  
**Риски:** Новые unhandled rejections

### Проблема

```typescript
// query.ts:1005
void executePostSamplingHooks(...)  // ❌ Подавляет ошибки

// QueryEngine.ts:725
void recordTranscript(messages)      // ❌ Fire-and-forget
```

### Решение

#### Паттерн 1: Async с обработкой

```typescript
// Было:
void executePostSamplingHooks(...)

// Стало:
try {
  await executePostSamplingHooks(...)
} catch (error) {
  logError('Failed to execute post-sampling hooks', error)
  // Не критично — продолжаем
}
```

#### Паттерн 2: Fire-and-forget с логированием

```typescript
// Было:
void recordTranscript(messages)

// Стало:
recordTranscript(messages).catch(error => {
  logError('Failed to record transcript', error)
})
```

#### Паттерн 3: AbortSignal для отмены

```typescript
// Для длительных операций
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal
): Promise<T> {
  // Реализация с AbortController
}
```

### Файлы для исправления

| Файл | Строки | Количество |
|------|--------|------------|
| `query.ts` | 1005, 1100, 1430 | 5+ |
| `QueryEngine.ts` | 725, 890, 1200 | 3+ |
| `bashPermissions.ts` | 127, 450 | 2+ |

### ESLint правило

```json
// .eslintrc.json
{
  "rules": {
    "@typescript-eslint/no-floating-promises": "error"
  }
}
```

---

## Фаза 3: Тестирование — Permissions

**Приоритет:** P1  
**Оценка времени:** 2-3 дня  
**Риски:** Не покрыть edge cases

### Цель

Добить покрытие `bashPermissions.ts` до 80%.

### Тестовые сценарии

```typescript
// src/tools/BashTool/__tests__/bashPermissions.test.ts

describe('bashToolHasPermission', () => {
  describe('deny rules', () => {
    it('should deny command with LD_PRELOAD', async () => {
      const result = await bashToolHasPermission({
        command: 'LD_PRELOAD=/evil.so ls'
      }, mockContext)
      expect(result.behavior).toBe('deny')
    })

    it('should deny rm -rf /', async () => {
      const result = await bashToolHasPermission({
        command: 'rm -rf /'
      }, mockContext)
      expect(result.behavior).toBe('deny')
    })
  })

  describe('path constraints', () => {
    it('should ask for paths outside project', async () => {
      const result = await bashToolHasPermission({
        command: 'cat /etc/passwd'
      }, mockContext)
      expect(result.behavior).toBe('ask')
    })
  })

  describe('compound commands', () => {
    it('should handle cd && git', async () => {
      const result = await bashToolHasPermission({
        command: 'cd /tmp && git status'
      }, mockContext)
      expect(result.behavior).toBe('ask')
    })
  })

  describe('wildcards', () => {
    it('should match Bash(ls:*)', async () => {
      const context = withRule('Bash(ls:*)', 'allow')
      const result = await bashToolHasPermission({
        command: 'ls -la'
      }, context)
      expect(result.behavior).toBe('allow')
    })
  })
})
```

### Инфраструктура

```typescript
// src/tools/BashTool/__tests__/helpers.ts

export function createMockContext(
  overrides?: Partial<ToolUseContext>
): ToolUseContext {
  return {
    getAppState: () => ({
      toolPermissionContext: {
        mode: 'ask',
        alwaysAllowRules: new Map(),
        alwaysDenyRules: new Map(),
        // ...
      }
    }),
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
    ...overrides
  }
}

export function withRule(
  rule: string,
  behavior: 'allow' | 'deny' | 'ask'
): ToolUseContext {
  // Создать контекст с добавленным правилом
}
```

### Запуск тестов

```bash
npm test -- src/tools/BashTool/__tests__
npm test -- --coverage --collectCoverageFrom='src/tools/BashTool/**/*.ts'
```

---

## Фаза 4: TypeScript Strict Mode

**Приоритет:** P1  
**Оценка времени:** 2-3 дня  
**Риски:** Много ошибок компиляции

### План

#### Шаг 4.1: Включить постепенно

```json
// tsconfig.json
{
  "compilerOptions": {
    // Было:
    "strict": false,

    // Стало (постепенно):
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictFunctionTypes": true,
    // ... остальные
  }
}
```

#### Шаг 4.2: Заменить `any`

```typescript
// Было:
type AnyToolDef = ToolDef<any, any, any>

// Стало:
type AnyToolDef = ToolDef<unknown, unknown, unknown>
// Или лучше — вывести строгий union type
```

#### Шаг 4.3: Убрать `!`

```typescript
// Было:
const block = message.message.content[i]!

// Стало:
const block = message.message.content[i]
if (!block) {
  throw new Error(`Content block at index ${i} not found`)
}
```

#### Шаг 4.4: Типизировать все возвраты

```typescript
// Было:
function processMessages(messages) { // any

// Стало:
function processMessages(messages: Message[]): ProcessedMessage[] {
```

### Порядок файлов

1. `src/types/*.ts` — сначала типы
2. `src/utils/*.ts` — утилиты
3. `src/tools/*.ts` — tools
4. `src/query.ts` — core logic
5. `src/main.tsx` — entry point

---

## Фаза 5: Архитектура — DI и модули

**Приоритет:** P2  
**Оценка времени:** 5-7 дней  
**Риски:** Большой рефакторинг

### Цель

Разорвать циклические зависимости через DI.

### Текущие циклы

```
Tool.ts → permissions.ts → Tool.ts
query.ts → QueryEngine.ts → query.ts
utils/cwd.ts → utils/envUtils.ts → utils/cwd.ts
```

### Решение: DI Container

```typescript
// src/di/container.ts

export interface Container {
  get<T>(token: Token<T>): T
  register<T>(token: Token<T>, provider: Provider<T>): void
}

// Tokens
export const TOKENS = {
  fileSystem: token<FileSystem>('fileSystem'),
  permissionChecker: token<PermissionChecker>('permissionChecker'),
  logger: token<Logger>('logger'),
}
```

### Рефакторинг пример

**Было:**

```typescript
// bashPermissions.ts
import { getCwd } from '../../utils/cwd.js'
import { logEvent } from '../../services/analytics/index.js'

async function bashToolHasPermission(...) {
  const cwd = getCwd() // Прямой вызов
  logEvent('tengu_bash_tool_use', {...}) // Прямой вызов
}
```

**Стало:**

```typescript
interface Dependencies {
  getCwd: () => string
  logEvent: (event: string, data: unknown) => void
}

async function bashToolHasPermission(
  input: Input,
  context: ToolUseContext,
  deps: Dependencies // Внедренные зависимости
): Promise<PermissionResult> {
  const cwd = deps.getCwd()
  deps.logEvent('tengu_bash_tool_use', {...})
}
```

### Shared utilities

```typescript
// src/security/unc.ts

export function isUncPath(path: string): boolean {
  return path.startsWith('\\\\') || /^[a-zA-Z]:\\/.
}

// Использование в FileReadTool.ts и FileWriteTool.ts
```

---

## Фаза 6: Производительность

**Приоритет:** P2  
**Оценка времени:** 3-5 дней

### 6.1 Lazy Loading

```typescript
// Было:
import { CoordinatorMode } from './coordinator/coordinatorMode.js'

// Стало:
const { CoordinatorMode } = await import('./coordinator/coordinatorMode.js')
```

### 6.2 Memoization

```typescript
// React/Ink компоненты
import { useMemo, useCallback, memo } from 'react'

const ExpensiveComponent = memo(function ExpensiveComponent({ data }) {
  const processed = useMemo(() => {
    return heavyTransform(data)
  }, [data])

  const handleClick = useCallback(() => {
    onItemClick(processed.id)
  }, [processed.id, onItemClick])

  return <div onClick={handleClick}>{processed.name}</div>
})
```

### 6.3 Cleanup для Map

```typescript
// Было:
const speculativeChecks = new Map<string, Promise<...>>()

// Стало:
class TTLMap<K, V> {
  private map = new Map<K, { value: V; expiry: number }>()

  set(key: K, value: V, ttlMs: number): void {
    this.map.set(key, { value, expiry: Date.now() + ttlMs })
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiry) {
      this.map.delete(key)
      return undefined
    }
    return entry.value
  }
}
```

### 6.4 Web Workers

```typescript
// src/workers/tokenizer.worker.ts

self.onmessage = async (event) => {
  const { text, model } = event.data
  const tokens = await tokenize(text, model)
  self.postMessage({ tokens })
}

// Использование
const worker = new Worker('./tokenizer.worker.js')
worker.postMessage({ text: largeContent, model: 'claude' })
```

---

## Таймлайн и ресурсы

### Общая оценка

| Фаза | Время | Разработчики | Зависимости |
|------|-------|--------------|-------------|
| 1. main.tsx | 3-5 дней | 1 senior | — |
| 2. Promise handling | 1-2 дня | 1 mid | — |
| 3. Тесты | 2-3 дня | 1 mid | Фаза 2 |
| 4. Strict TS | 2-3 дня | 1 senior | — |
| 5. DI | 5-7 дней | 2 mid | Фаза 1 |
| 6. Performance | 3-5 дней | 1 senior | Фаза 5 |

**Итого:** 16-25 дней (1 разработчик = ~2 месяца)

### Приоритезация по пользе/усилиям

| Задача | Польза | Усилия | ROI |
|--------|--------|--------|-----|
| Убрать `void` Promise | Высокая | Низкие | ⭐⭐⭐⭐⭐ |
| Тесты permissions | Высокая | Средние | ⭐⭐⭐⭐⭐ |
| Разделить main.tsx | Высокая | Высокие | ⭐⭐⭐⭐ |
| Strict TS | Средняя | Средние | ⭐⭐⭐ |
| DI | Средняя | Высокие | ⭐⭐⭐ |
| Performance tweaks | Средняя | Средние | ⭐⭐⭐ |

### Рекомендуемый порядок

**Месяц 1:**
1. Убрать `void` Promise (3 дня)
2. Тесты permissions (5 дней)
3. Strict TS — часть 1 (5 дней)

**Месяц 2:**
1. Разделить main.tsx (10 дней)
2. Strict TS — часть 2 (5 дней)

**Месяц 3+:**
1. DI внедрение
2. Performance оптимизации

---

## Контрольные метрики

### До рефакторинга

- Bundle size: ~800KB (main.tsx)
- Test coverage: ~5%
- TypeScript errors (strict): 500+
- `any` usages: 47
- `void` Promise: 20+

### Цели

- Bundle size: <200KB initial, lazy load rest
- Test coverage: 30%+ (core modules 70%+)
- TypeScript errors (strict): 0
- `any` usages: <10
- `void` Promise: 0

---

## Риски и mitigation

| Риск | Вероятность | Влияние | Mitigation |
|------|-------------|---------|------------|
| Сломать CLI | Средняя | Высокое | Smoke tests, feature flags |
| Регрессии permissions | Низкая | Критичное | Extensive unit tests |
| Увеличение bundle size | Низкая | Среднее | Monitoring, code splitting |
| Отставание от main | Средняя | Среднее | Регулярные rebase |

---

## Связанные документы

- CODE_REVIEW.md — полный отчёт код-ревью
- CLAUDE.md — инструкции проекта
- package.json — скрипты и зависимости
