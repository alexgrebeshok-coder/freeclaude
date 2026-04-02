# FreeClaude - Детальный план

## 🔍 Глубокий анализ

**Создано: форк Openclaude**, сложнее в том, просто сделать:

 1. **Проблема**

OpenClaude имеет  auth dance:
  - `--bare` mode не провер (  - `CLAUDE_CODE_USE_OPENai=1` bypasses all keychain/OAuth logic
  - API keys from env vars, Вспомс free provider UX

  - Fallback chain between providers

**План FreeClaude:**

### Э1. Исследование (30 мин)

Изучил кода, понял:

 что происходит и где проверяется auth. Начну с простым: созда FreeClaudeAuth мод. который определя, authed ли.

 Если validation.

**4. Модифика Openclaude****

#### **Модифика #1: Упрощаем auth flow**

**Файлы:**
- `src/services/api/freeclaudeAuth.ts` — новый auth logic
- `src/services/api/errors.ts` — обнов error messages
- `src/services/api/client.ts` — add OpenAI shim logic
            (will be removed once `checkAndRefreshOAuth` steps)
            return new error messages from `getAnthropicApiKeyWithSource` and `getApiKeyFromApiKeyHelperCached` will be skip keychain reads
                return null
              }
            }
          }
        }
      })
    }
  })

  // Fallback support
  if (isOpen.length > 0) {
    console.error('[API:Auth] OAuth token check failed')
    console.error('[API:auth] OAuth token check complete')
    const { createOpenAIShimClient } = await import('./openaiShim.js')
  return createOpenAIShimClient({
    defaultHeaders,
    maxRetries,
    timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10,
    dangerouslyAllowBrowser: true,
            fetchOptions: getProxyFetchOptions({
              forAnthropicAPI: true,
            }) as ClientOptions,
          timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000),
            dangerouslyAllowBrowser: true,
          ...(resolvedFetch && {
            ...defaultHeaders,
          }
        },
      }),
    }),
  })

  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI)) {
    const { createOpenAIShimClient } from await import('./openaiShim.js')
    return createOpenAIShimClient(ARGS)
  }) as unknown as Anthropic
  }
}
```

### 1.2 Упрощённая авторизация

Создад новый модуль `freeclaudeAuth.ts` в `src/services/api/`:

 path: `src/services/api/freeclaudeAuth.ts`
path: `src/services/api/freeclaudeAuth.ts`
