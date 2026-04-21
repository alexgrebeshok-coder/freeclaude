# FreeClaude Code Review

**Date:** 2026-04-21  
**Scope:** Core codebase (src/, package.json, tsconfig.json)  
**Total lines:** ~418,000

---

## Summary

FreeClaude — это форк Claude Code с поддержкой multi-provider (ZAI, Ollama, Gemini, DeepSeek, OpenAI). Проект имеет сложную архитектуру с чёткой структурой, но есть ряд архитектурных и инженерных проблем, которые стоит адресовать.

### Ключевые характеристики
- **Entry point:** `src/main.tsx` (802K+ строк)
- **Query Engine:** `src/QueryEngine.ts` (около 500-1000 строк)
- **Commands:** `src/commands.ts` (778 строк)
- **Tool System:** `src/Tool.ts` (сложная type-система)
- **TUI Framework:** React + Ink

---

## Critical Issues

### 1. Огромный main.tsx (802K+ строк)
**Location:** `src/main.tsx`

Это монолитный файл с огромным количеством импортов и side-effects. Читаемость и поддерживаемость низкие.

**Problems:**
- 802K+ строк делает его трудным для понимания
- Обилие side-effects на top-level
- Смешение ответственности (bootstrap, imports, lazy loading)

**Recommendation:** Разделить на модули:
```
src/main/
  ├── bootstrap.ts
  ├── cli.ts
  ├── imports.ts
  └── index.ts
```

### 2. Circular Dependencies Risk
**Location:** `src/main.tsx:69-73`

```typescript
// Lazy require to avoid circular dependency: teammate.ts -> AppState.tsx -> ... -> main.tsx
const getTeammateUtils = () => require('./utils/teammate.js')
```

Признак архитектурной проблемы — наличие `require` для обхода циклических зависимостей.

### 3. Feature Flags через Dead Code Elimination
**Location:** Multiple files

```typescript
const coordinatorModeModule = feature('COORDINATOR_MODE') 
  ? require('./coordinator/coordinatorMode.js') 
  : null;
```

**Problems:**
- Распределённая логика feature flags
- Условные импорты усложняют понимание кода
- Риск runtime ошибок если `feature()` вернёт unexpected value

### 4. Duplicate Command Import
**Location:** `src/commands.ts:19,74`

```typescript
import cost from './commands/cost/index.js'  // line 19
import cost from './commands/cost/index.js'  // line 74 - DUPLICATE!
```

Также дублируется `model` (строки 28 и 173).

### 5. Top-Level Side Effects
**Location:** `src/main.tsx:10,16,20`

```typescript
profileCheckpoint('main_tsx_entry');  // side effect
startMdmRawRead();                     // side effect  
startKeychainPrefetch();               // side effect
```

**Problems:**
- Неявное поведение при импорте
- Сложно тестировать
- Порядок импортов критичен

---

## High Priority

### 6. Weak Type Safety in Tool System
**Location:** `src/Tool.ts:15-21`

```typescript
export type ToolInputJSONSchema = {
  [x: string]: unknown  // weak typing
  type: 'object'
  properties?: {
    [x: string]: unknown  // weak typing
  }
}
```

Использование `unknown` вместо конкретных типов понижает безопасность.

### 7. Function Complexity in setup.ts
**Location:** `src/setup.ts:56-477`

Функция `setup()` — 420+ строк с множеством ответственностей:
- Version checking
- Session management
- Worktree handling
- Terminal backup
- Permission validation

**Recommendation:** Разделить на отдельные функции.

### 8. Magic Numbers
**Location:** `src/query.ts:164`

```typescript
const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3
```

Магическая константа без пояснения почему именно 3 (а не 5 или 10).

### 9. Biome Ignore Comments
**Location:** `src/commands.ts:1`, `src/query.ts:1`

```typescript
// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
```

Необходимость этих комментариев указывает на сложность импортов.

### 10. Mixed Import Styles
**Location:** Multiple files

Смешивание `require` и `import` создаёт непоследовательность:
```typescript
import { something } from './module.js'
const lazy = feature('X') ? require('./other.js') : null
```

---

## Medium Priority

### 11. tsconfig paths Configuration
**Location:** `tsconfig.json:16-18`

```json
"paths": {
  "src/*": ["./src/*"]
}
```

Хорошо, но не используется консистентно. Некоторые импорты используют `src/`, другие относительные пути.

### 12. Missing Return Type Annotations
**Location:** Multiple files

Многие функции не имеют явных return type annotations:
```typescript
export async function setup(...) // no return type
```

### 13. Hardcoded Strings
**Location:** `src/setup.ts:71-79`, `src/commands.ts:426-437`

Много проверок на базе строк:
```typescript
if (process.env.USER_TYPE === 'ant')
if (process.env.CLAUDE_CODE_ENTRYPOINT !== 'local-agent')
```

### 14. Console Usage in Setup
**Location:** `src/setup.ts:72-79`

```typescript
console.error(
  chalk.bold.red(
    'Error: FreeClaude requires Node.js version 18 or higher.',
  ),
)
process.exit(1)
```

Жёсткий `process.exit()` затрудняет graceful degradation.

### 15. Dependency on bun:bundle
**Location:** Multiple files

Сильная зависимость от Bun-specific features:
```typescript
import { feature } from 'bun:bundle'
```

Это ограничивает переносимость.

---

## Low Priority

### 16. File Organization
Некоторые директории перегружены:
- `src/utils/` — 342+ файла
- `src/services/` — 53+ директорий
- `src/commands/` — 125+ файлов

### 17. Naming Inconsistencies
- `src/commands.ts` (camelCase)
- `src/QueryEngine.ts` (PascalCase)
- Некоторые файлы используют snake_case: `src/commands/ctx_viz/`

### 18. Large Type Definitions
**Location:** `src/Tool.ts`

Очень большие union types и conditional types усложняют компиляцию.

### 19. Inline Comments Instead of Documentation
Многие места имеют обстоятельные inline комментарии вместо JSDoc.

### 20. Test Coverage
Нет видимой интеграции unit tests в исходный код (test файлы в отдельной директории).

---

## Positives

### 1. Strict TypeScript Configuration
```json
"strict": true,
"forceConsistentCasingInFileNames": true
```

### 2. Module Resolution
Использование `"moduleResolution": "bundler"` — современный подход.

### 3. Feature Flags System
Наличие feature flags позволяет постепенный rollout.

### 4. Error Handling
Хорошая обработка ошибок в многих местах:
```typescript
try {
  const result = await riskyOperation()
} catch (error) {
  logError(toError(error))
  // fallback
}
```

### 5. Code Comments
Обстоятельные комментарии объясняют intent (особенно в сложных местах).

### 6. Separation of Concerns
Хорошее разделение на `services/`, `utils/`, `commands/`, `tools/`.

### 7. Lazy Loading Strategy
Conditional imports для оптимизации:
```typescript
const module = feature('X') ? require('./module.js') : null
```

### 8. Type Safety for Commands
Хорошо типизирована Command система с discriminated unions.

---

## Recommendations

### Immediate Actions (Fix Now)
1. **Remove duplicate imports** in `commands.ts`
2. **Add return types** to key functions
3. **Extract magic numbers** в именованные константы
4. **Create barrel exports** для уменьшения дублирования импортов

### Short Term (Next Sprint)
1. **Refactor main.tsx** — разделить на модули
2. **Resolve circular dependencies** — реструктурировать зависимости
3. **Standardize import paths** — использовать `src/` alias консистентно
4. **Improve test coverage** — интегрировать тесты

### Long Term (Roadmap)
1. **Modular architecture** — выделить MCP, providers, voice как отдельные пакеты
2. **Plugin API** — формализовать plugin system
3. **Documentation** — JSDoc для всех public APIs
4. **CI/CD improvements** — lint, test, build gates

---

## Architecture Diagram (Conceptual)

```
┌─────────────────────────────────────┐
│           Entry Point               │
│         (main.tsx - refactor)       │
└─────────────┬───────────────────────┘
              │
    ┌─────────┴─────────┐
    │                   │
┌───▼────┐         ┌────▼────┐
│  CLI   │         │   TUI   │
│ Layer  │         │ (Ink)   │
└───┬────┘         └────┬────┘
    │                   │
    └─────────┬─────────┘
              │
    ┌─────────▼──────────┐
    │   QueryEngine      │
    │  (Orchestration)   │
    └─────────┬──────────┘
              │
    ┌─────────┼─────────┐
    │         │         │
┌───▼───┐ ┌──▼────┐ ┌──▼───┐
│ Tools │ │ MCP   │ │Providers
└───────┘ └───────┘ └──────┘
```

---

## Security Considerations

### Low Risk
- API keys stored outside codebase
- MCP server validation
- Permission system с различными режимами (`permissionMode`)

### Medium Risk
- Process.exit() в неожиданных местах
- Environment variable checks распределены по коду

### High Risk
- `dangerously-skip-permissions` флаг (но с проверкой sandbox)

---

## Performance Observations

### Good
- Lazy loading для больших модулей
- Memoization в `commands.ts` (`memoize` from lodash)
- Feature flags для dead code elimination

### Could Improve
- `main.tsx` загружается целиком при старте
- Много feature() вызовов на runtime (vs compile-time)

---

## Conclusion

FreeClaude — это качественный форк с хорошей архитектурной базой. Основные проблемы:
1. **Размер entry point** — технический долг
2. **Circular dependencies** — архитектурный долг
3. **Inconsistent coding style** — легко исправить

Рекомендую начать с рефакторинга `main.tsx` и устранения duplicate imports — это даст немедленное улучшение.

**Overall Grade: B+** (хороший код, но есть технический долг для устранения)
