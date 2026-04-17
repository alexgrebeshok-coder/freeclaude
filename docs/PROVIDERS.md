# Providers Guide

Complete guide to all supported AI providers in FreeClaude v3.2.6.

## Supported Providers

| Provider | Type | Pricing | Best For | Status |
|----------|------|---------|----------|--------|
| 🇷🇺 **ZAI** | Free | Free | Russia, Russian language | ✅ |
| 🏠 **Ollama** | Local | Free | Privacy, offline work | ✅ |
| 🌐 **Google Gemini** | Free tier | Free (15 RPM) | Global, fast responses | ✅ |
| 🔀 **OpenRouter** | Router | Varies by model | Access to 200+ models | ✅ |
| 💰 **DeepSeek** | Paid | $0.14/M tokens | High quality reasoning | ✅ |
| ⚡ **Groq** | Free tier | Free tier + paid | Ultra-fast inference | ✅ |
| 🚀 **Cerebras** | Free tier | Free tier + paid | Fastest inference | ✅ |
| 🇨🇳 **Qwen/DashScope** | Free tier | Free tier | Chinese models | ✅ |
| 🔧 **OpenAI** | Paid | Pay per use | GPT-4o, GPT-4o-mini | ✅ |
| 🔧 **Any OpenAI-compatible** | — | Varies | Custom endpoints | ✅ |

---

## Free Providers

### 🇷🇺 ZAI (GLM)

**Website:** https://open.bigmodel.cn  
**Status:** Free (with rate limits)  
**Best for:** Users in Russia, Russian language support  
**Speed:** ~15 seconds (includes reasoning time)  
**API Endpoint:** `https://api.z.ai/api/coding/paas/v4`

**Available Models:**
- `glm-4.7-flash` — Fast, good for most tasks
- `glm-5-turbo` — Better quality
- `glm-5.1` — Latest version

**Setup:**
```bash
export ZAI_API_KEY="07b98bdc1bcf4701aa0ec63a55a2e1aa.xxxxx"
/setup zai
```

**Config:**
```json
{
  "name": "zai",
  "baseUrl": "https://api.z.ai/api/coding/paas/v4",
  "apiKey": "env:ZAI_API_KEY",
  "model": "glm-4.7-flash"
}
```

**Pros:**
- Completely free
- Native Russian support
- Works from Russia
- Good reasoning capabilities

**Cons:**
- Slower than other providers
- Can be overloaded during peak times

---

### 🏠 Ollama (Local)

**Website:** https://ollama.ai  
**Status:** Free, 100% local  
**Best for:** Privacy, offline work, no API limits  
**Speed:** Depends on hardware (M1/M2: ~1-2s, older: 5-10s)  
**API Endpoint:** `http://localhost:11434/v1`

**Recommended Models:**

| Model | Size | Use Case | VRAM Required |
|-------|------|----------|---------------|
| `qwen2.5:3b` | 3B | Fast, simple tasks | 4GB |
| `qwen2.5-coder:7b` | 7B | Coding tasks | 8GB |
| `llama3.2` | 3B | General purpose | 4GB |
| `deepseek-coder:6.7b` | 6.7B | Code generation | 8GB |
| `codellama:13b` | 13B | Advanced coding | 16GB |

**Setup:**
```bash
# Install Ollama
brew install ollama

# Pull a model
ollama pull qwen2.5-coder:7b

# Start server
ollama serve

# Add to FreeClaude
/setup ollama
```

**Config:**
```json
{
  "name": "ollama",
  "baseUrl": "http://localhost:11434/v1",
  "apiKey": "ollama",
  "model": "qwen2.5-coder:7b"
}
```

**Pros:**
- 100% free
- Works offline
- No data leaves your machine
- No rate limits

**Cons:**
- Requires GPU/CPU power
- Setup complexity
- Smaller models = lower quality

---

### 🌐 Google Gemini

**Website:** https://aistudio.google.com/apikey  
**Status:** Free tier available  
**Best for:** Global access, fast responses  
**Speed:** ~3 seconds  
**API Endpoint:** `https://generativelanguage.googleapis.com/v1beta/openai`

**Available Models:**
- `gemini-2.5-flash-lite` — Free tier, fast
- `gemini-2.0-flash` — Better quality
- `gemini-1.5-pro` — Best quality (paid)

**Setup:**
```bash
export GEMINI_API_KEY="AIzaSy..."
/setup gemini
```

**Config:**
```json
{
  "name": "gemini",
  "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
  "apiKey": "env:GEMINI_API_KEY",
  "model": "gemini-2.5-flash-lite"
}
```

**Free Tier Limits:**
- 15 requests per minute (RPM)
- 1000 requests per day (variable)

**Pros:**
- Generous free tier
- Fast responses
- Good for most tasks

**Cons:**
- Rate limits
- May hallucinate more than GPT-4

---

### ⚡ Groq

**Website:** https://console.groq.com/keys  
**Status:** Free tier + pay-as-you-go  
**Best for:** Speed, low latency  
**Speed:** ~1 second (fastest)  
**API Endpoint:** `https://api.groq.com/openai/v1`

**Available Models:**
- `llama-3.3-70b-versatile` — Best balance
- `llama-3.1-8b-instant` — Ultra-fast
- `mixtral-8x7b-32768` — Good quality

**Setup:**
```bash
export GROQ_API_KEY="gsk_..."
/setup groq
```

**Free Tier Limits:**
- 20 requests per minute
- 600,000 tokens per minute
- 1,000,000 tokens per day

**Pros:**
- Fastest provider
- Good free tier
- Low latency

**Cons:**
- Mostly Llama models
- Rate limits on free tier

---

### 🚀 Cerebras

**Website:** https://cloud.cerebras.ai  
**Status:** Free tier + paid  
**Best for:** Ultra-fast inference  
**Speed:** ~0.5 seconds  
**API Endpoint:** `https://api.cerebras.ai/v1`

**Available Models:**
- `llama3.1-8b` — Fast inference
- `llama3.1-70b` — Higher quality

**Setup:**
```bash
export CEREBRAS_API_KEY="csk_..."
/setup cerebras
```

**Pros:**
- Fastest inference available
- Good free tier

**Cons:**
- Limited model selection
- Can have capacity issues

---

## Paid Providers

### 💰 DeepSeek

**Website:** https://platform.deepseek.com  
**Pricing:** $0.14 per 1M tokens  
**Best for:** High quality, reasoning tasks  
**Speed:** ~3 seconds  
**API Endpoint:** `https://api.deepseek.com/v1`

**Models:**
- `deepseek-chat` — General purpose
- `deepseek-reasoner` — Chain-of-thought reasoning

**Setup:**
```bash
export DEEPSEEK_API_KEY="sk-..."
/setup deepseek
```

**Why use it:**
- Excellent code generation
- Very low cost
- Good reasoning capabilities

---

### 🔀 OpenRouter

**Website:** https://openrouter.ai/keys  
**Pricing:** Varies by model  
**Best for:** Access to many models in one place  
**API Endpoint:** `https://openrouter.ai/api/v1`

**Popular Models:**

| Model | Provider | Price/1M tokens |
|-------|----------|-----------------|
| `anthropic/claude-sonnet-4` | Anthropic | $3 / $15 |
| `anthropic/claude-haiku-4-5` | Anthropic | $0.25 / $1.25 |
| `openai/gpt-4o` | OpenAI | $2.50 / $10 |
| `openai/gpt-4o-mini` | OpenAI | $0.15 / $0.60 |
| `meta-llama/llama-3.3-70b` | Meta | $0.12 / $0.30 |
| `google/gemini-2.5-pro` | Google | $1.25 / $10 |

**Setup:**
```bash
export OPENROUTER_API_KEY="sk-or-..."
/setup openrouter

# Then select model
/model openrouter anthropic/claude-sonnet-4
```

**Config:**
```json
{
  "name": "openrouter",
  "baseUrl": "https://openrouter.ai/api/v1",
  "apiKey": "env:OPENROUTER_API_KEY",
  "model": "anthropic/claude-sonnet-4"
}
```

**Pros:**
- 200+ models
- Unified billing
- Easy to switch models

---

### 🔧 OpenAI

**Website:** https://platform.openai.com  
**Pricing:** Pay per use

**Models:**
- `gpt-4o` — Best quality ($2.50 / $10 per 1M)
- `gpt-4o-mini` — Good value ($0.15 / $0.60 per 1M)
- `o3-mini` — Reasoning model

**Setup:**
```bash
export OPENAI_API_KEY="sk-..."
/setup openai
```

**Note:** May be geo-restricted in some regions.

---

## Fallback Chain

FreeClaude automatically falls back to the next available provider if one fails:

```
Request → Primary Provider (priority 1)
   ↓ (fails)
Fallback Provider 1 (priority 2)
   ↓ (fails)
Fallback Provider 2 (priority 3)
   ↓ (fails)
Error
```

**How it works:**
- Timeout (default: 30s)
- 5xx errors
- 403 geo-restrictions
- Rate limits (429)

**Configure priority in `~/.freeclaude.json`:**
```json
{
  "providers": [
    { "name": "zai", "priority": 1 },
    { "name": "ollama", "priority": 2 },
    { "name": "gemini", "priority": 3 }
  ]
}
```

**Manual fallback:**
```
> /model
Provider 1: zai [ACTIVE] ✓
Provider 2: ollama
Provider 3: gemini

> /model 2
Switched to ollama
```

---

## Geo-Restrictions

Some providers are blocked in certain regions:

| Region | Blocked Providers | Available Alternatives |
|--------|-------------------|------------------------|
| 🇷🇺 Russia | Anthropic, OpenAI | ZAI, Ollama, Gemini (sometimes), DeepSeek |
| 🇨🇳 China | OpenAI, Anthropic, Gemini | ZAI, local Ollama |
| 🇮🇷 Iran | Most Western APIs | Ollama, local models |
| 🇳🇰 North Korea | All Western | Ollama only |

**Understanding error codes:**
- `403 Forbidden` — Geo-blocked
- `429 Too Many Requests` — Rate limited
- `500/503` — Provider error
- `ECONNREFUSED` — Endpoint unreachable

**Troubleshooting blocks:**
```bash
# Test provider from your location
curl -H "Authorization: Bearer $API_KEY" \
  https://api.openai.com/v1/models

# If blocked, switch provider
/setup zai
```

---

## Provider Comparison

| Provider | Cost | Speed | Quality | Russia | Offline |
|----------|------|-------|---------|--------|---------|
| ZAI | Free | Slow | ⭐⭐⭐⭐ | ✅ | ❌ |
| Ollama | Free | Medium | ⭐⭐⭐ | ✅ | ✅ |
| Gemini | Free | Fast | ⭐⭐⭐⭐ | ⚠️ | ❌ |
| DeepSeek | Cheap | Fast | ⭐⭐⭐⭐⭐ | ✅ | ❌ |
| OpenRouter | Varies | Fast | ⭐⭐⭐⭐⭐ | ⚠️ | ❌ |
| Groq | Free tier | Fastest | ⭐⭐⭐ | ✅ | ❌ |

**Recommendations:**
- **In Russia:** ZAI (best), Ollama (for privacy)
- **Global free:** Gemini, Groq
- **Best quality:** OpenRouter with Claude/GPT-4
- **Privacy:** Ollama
- **Budget:** DeepSeek, Gemini

---

## Quick Setup Commands

```bash
# Auto-detect best provider
/setup auto

# Show free providers only
/setup free

# Show local providers
/setup local

# Add specific provider
/setup zai
/setup ollama
/setup gemini

# Test all providers
/providers test

# Check provider status
/doctor
```
