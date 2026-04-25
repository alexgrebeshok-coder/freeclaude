# FreeClaude Provider Setup Guide

## ✅ Working Providers

### 1. ZAI (Рекомендуется для РФ)
**Status:** ✅ Working
**Price:** Free
**Setup:**
```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY="07b98bdc1bcf4701aa0ec63a55a2e1aa.IonFMBpmLlTFf1U7"
export OPENAI_BASE_URL="https://api.z.ai/api/coding/paas/v4"
export OPENAI_MODEL="glm-4.7-flash"
```

**Test:**
```bash
fc -p "Привет"
```

---

## ⏸️ Pending Setup

### 2. DeepSeek
**Status:** ⏸️ Requires API Key
**Price:** $0.14/1M tokens
**Setup:**
```bash
# Get API key: https://platform.deepseek.com
export DEEPSEEK_API_KEY="sk-..."
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY="$DEEPSEEK_API_KEY"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
export OPENAI_MODEL="deepseek-chat"
```

---

### 3. Gemini
**Status:** ⏸️ Requires API Key
**Price:** Free (15 RPM)
**Setup:**
```bash
# Get API key: https://aistudio.google.com/apikey
export GEMINI_API_KEY="AIza..."
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY="$GEMINI_API_KEY"
export OPENAI_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
export OPENAI_MODEL="gemini-2.0-flash"
```

---

### 4. Ollama (Local)
**Status:** ⏸️ Requires Installation
**Price:** Free
**Setup:**
```bash
# Install Ollama
brew install ollama

# Pull model
ollama pull llama3.2

# Configure
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY="ollama"
export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_MODEL="llama3.2"
```

---

## 🚀 Quick Setup Script

Add to `~/.zshrc`:

```bash
# FreeClaude - ZAI Provider (default)
source ~/.openclaw/workspace/freeclaude/.env.zai

# Alternative providers (uncomment to use):
# source ~/.openclaw/workspace/freeclaude/.env.deepseek
# source ~/.openclaw/workspace/freeclaude/.env.gemini
# source ~/.openclaw/workspace/freeclaude/.env.ollama
```

---

## 📊 Provider Comparison

| Provider | Price | Speed | Russian | Quality |
|----------|-------|-------|---------|---------|
| **ZAI** | Free | ⚡ Fast | ✅ Native | ⭐⭐⭐⭐ |
| **DeepSeek** | $0.14/M | ⚡ Fast | ✅ Good | ⭐⭐⭐⭐⭐ |
| **Gemini** | Free (15 RPM) | ⚡ Fast | ⚠️ OK | ⭐⭐⭐⭐ |
| **Ollama** | Free | 🐢 Local | ✅ Good | ⭐⭐⭐ |

---

## 🔧 Fallback Chain (Recommended)

Create `.env.multi`:

```bash
# FreeClaude Multi-Provider Config
export CLAUDE_CODE_USE_OPENAI=1

# Primary: ZAI
export OPENAI_API_KEY="07b98bdc1bcf4701aa0ec63a55a2e1aa.IonFMBpmLlTFf1U7"
export OPENAI_BASE_URL="https://api.z.ai/api/coding/paas/v4"
export OPENAI_MODEL="glm-4.7-flash"

# Fallback (manual switch):
# export OPENAI_API_KEY="$DEEPSEEK_API_KEY"
# export OPENAI_BASE_URL="https://api.deepseek.com/v1"
# export OPENAI_MODEL="deepseek-chat"
```

---

## 🎯 Recommendation

**Для РФ:** ZAI (free, native Russian)
**Для других стран:** DeepSeek (cheap, high quality)
**Для privacy:** Ollama (local, no data leaves your machine)

---

## Fallback semantics

### Decision tree — error → action

- **HTTP 200** → success, reset provider error streak via `markSuccess()`
- **HTTP 408 / 425** → transient timeout / too-early → **retry-then-fallback**
- **HTTP 429** → rate-limited → **fallback** to next provider; parse `Retry-After`
  header with `parseRetryAfterMs()` to honour the wait (capped at 60 s)
- **HTTP 401** → invalid/revoked API key → **fallback + circuit-open**
  (`shouldCircuitOpen(401) === true`; caller should `markDown()` ×3)
- **HTTP 403 (geo/TOS restriction)** → provider blocks request for policy reasons
  → **fallback only**, NOT circuit-open (key is still valid)
- **HTTP 403 (pure auth refusal)** → key rejected → **fallback + circuit-open**
- **HTTP 500 / 502 / 503 / 504** → server error → **fallback**
- **ECONNREFUSED / ECONNRESET / ETIMEDOUT / ENOTFOUND / EAI_AGAIN** →
  network/DNS failure → **fallback** (`isNetworkError()` returns `true`)
- **`fetch failed`** → transport-layer error → **fallback**
- **AbortError** (user Ctrl-C / `AbortController.abort()`) →
  `isAbortError()` returns `true`; `shouldFallback()` returns **false** →
  **abort immediately, do NOT retry**
- **Stream cut** (truncated SSE / partial JSON) → `isStreamCutError()` returns
  `true` → **retry once, then fallback**
- **HTTP 400 model-not-found** → `isModelNotFoundError()` → **fallback**
- **HTTP 400 other** → bad request (caller bug) → **surface to caller**
- **Malformed JSON / empty body** → surface; no automatic fallback
  <!-- TODO(fallback-audit-2026-04): add isBodyError() + wire into shouldFallback -->

### Circuit-breaker

| Event | State transition |
|-------|-----------------|
| `markSuccess(provider)` | `unknown / degraded` → **healthy**; resets error streak |
| `markDown(provider)` × 1 | `healthy` → **degraded** (still in rotation) |
| `markDown(provider)` × 3 | → **down**; `markedDownAt` timestamp set |
| After **5 minutes** cooldown | → **unknown** (half-open probe) |
| Next request succeeds | `unknown` → **healthy** |
| Next request fails | `unknown` → **degraded** / **down** |

`shouldCircuitOpen(statusCode, error)` returns `true` for 401 and pure-auth
403. Callers that see `shouldCircuitOpen` return `true` should call
`chain.markDown(provider)` three times to immediately open the circuit rather
than waiting for the normal three-strike accumulation.

### Per-provider retry budget

There are no per-provider env-var overrides today.
<!-- TODO(fallback-audit-2026-04): expose FREECLAUDE_PROVIDER_<NAME>_MAX_RETRIES -->

### Troubleshooting

**Reading fallback logs**

FreeClaude logs every provider switch to stderr:
```
[FreeClaude] Switched to secondary (from primary, reason: error)
[FreeClaude] Provider primary marked down (3 consecutive errors, cooldown 5 min)
[FreeClaude] Provider primary recovered from cooldown (half-open probe)
```
Set `"logLevel": "debug"` in `~/.freeclaude.json` → `defaults` to see health
pings as well.

**Disabling the circuit-breaker for debugging**

Call `chain.markUp(providerName)` to instantly restore a provider:
```typescript
import { getSharedFallbackChain } from './src/services/api/fallbackChain.ts'
getSharedFallbackChain().markUp('primary')
```
Or set `"maxRetries": 0` in `~/.freeclaude.json` → `defaults` to skip retries
entirely and always surface the first error.
