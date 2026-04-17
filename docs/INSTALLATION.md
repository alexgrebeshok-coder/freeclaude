# Installation Guide

Complete installation and configuration guide for FreeClaude v3.2.6.

## Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | >= 20.0.0 | Required for runtime |
| **Bun** | Latest | Recommended for building |
| **OS** | macOS, Linux, Windows (WSL) | Native support |
| **Git** | Any | For cloning |

## Installation Methods

### Method 1: npm (Recommended)

```bash
npm install -g @freeclaude/cli
```

Binaries installed:
- `freeclaude` — Main CLI
- `fc` — Short alias
- `freeclaude-telegram` — Telegram bot

### Method 2: Git Clone & Build

```bash
git clone https://github.com/alexgrebeshok-coder/freeclaude.git
cd freeclaude
bun install
bun run build

# Option A: Link globally
npm link

# Option B: Run directly
node dist/cli.mjs
```

### Method 3: Homebrew (macOS/Linux)

```bash
# Coming soon
brew tap alexgrebeshok-coder/freeclaude
brew install freeclaude
```

### Method 4: Docker

```bash
docker pull alexgrebeshok/freeclaude:latest
docker run -it alexgrebeshok/freeclaude
```

---

## Provider Setup

FreeClaude works with any OpenAI-compatible API. Here are the supported providers:

### 🇷🇺 ZAI (Recommended for Russia)

**Price:** Free  
**Speed:** ~15s (with reasoning)  
**Registration:** https://open.bigmodel.cn

```bash
# Set environment variables
export ZAI_API_KEY="your-api-key"

# Or configure in FreeClaude
/setup zai
```

### 🏠 Ollama (Local)

**Price:** Free  
**Speed:** ~1-2s (depends on hardware)  
**Privacy:** 100% local

```bash
# 1. Install Ollama
brew install ollama

# 2. Pull a model
ollama pull qwen2.5:7b
ollama pull llama3.2

# 3. Start Ollama server
ollama serve

# 4. Add to FreeClaude
/setup ollama
```

**Recommended models:**
- `qwen2.5-coder:7b` — Best for coding
- `llama3.2` — Good balance
- `deepseek-coder:6.7b` — Code-specific

### 🌐 Google Gemini

**Price:** Free tier (15 RPM)  
**Speed:** ~3s  
**Registration:** https://aistudio.google.com/apikey

```bash
export GEMINI_API_KEY="your-api-key"
/setup gemini
```

### 🔀 OpenRouter

**Price:** Varies by model  
**Models:** 200+ models  
**Registration:** https://openrouter.ai/keys

```bash
export OPENROUTER_API_KEY="sk-or-your-key"
/setup openrouter
```

**Popular models on OpenRouter:**
- `anthropic/claude-sonnet-4` — Best quality
- `anthropic/claude-haiku-4-5` — Fast & cheap
- `openai/gpt-4o` — OpenAI alternative
- `meta-llama/llama-3.3-70b` — Open source

### 💰 DeepSeek

**Price:** $0.14 per 1M tokens  
**Speed:** ~3s  
**Registration:** https://platform.deepseek.com

```bash
export DEEPSEEK_API_KEY="sk-your-key"
/setup deepseek
```

### ⚡ Groq

**Price:** Free tier available  
**Speed:** ~1s (fastest)  
**Registration:** https://console.groq.com/keys

```bash
export GROQ_API_KEY="gsk-your-key"
/setup groq
```

### 🚀 Cerebras

**Price:** Free tier available  
**Speed:** ~0.5s (ultra-fast)  
**Registration:** https://cloud.cerebras.ai

```bash
export CEREBRAS_API_KEY="csk-your-key"
/setup cerebras
```

---

## Configuration File

FreeClaude stores configuration in `~/.freeclaude.json`:

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
      "model": "qwen2.5:7b",
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

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Provider identifier |
| `baseUrl` | string | API endpoint URL |
| `apiKey` | string | API key or `"env:VAR_NAME"` |
| `model` | string | Default model for provider |
| `priority` | number | Fallback order (lower = higher priority) |
| `timeout` | number | Request timeout in milliseconds |

---

## Environment Variables

These variables override config file settings:

| Variable | Description | Example |
|----------|-------------|---------|
| `ZAI_API_KEY` | ZAI API key | `07b9...` |
| `OPENROUTER_API_KEY` | OpenRouter key | `sk-or-...` |
| `GEMINI_API_KEY` | Google Gemini key | `AIza...` |
| `DEEPSEEK_API_KEY` | DeepSeek key | `sk-...` |
| `GROQ_API_KEY` | Groq key | `gsk-...` |
| `CEREBRAS_API_KEY` | Cerebras key | `csk-...` |
| `OLLAMA_HOST` | Ollama host | `http://localhost:11434` |
| `CLAUDE_CODE_USE_OPENAI` | Use OpenAI compat mode | `1` |
| `OPENAI_API_KEY` | Generic OpenAI key | `sk-...` |
| `OPENAI_BASE_URL` | Generic base URL | `https://api...` |
| `OPENAI_MODEL` | Generic model | `gpt-4o` |

---

## Troubleshooting

### "Command not found: freeclaude"

```bash
# Check if npm global bin is in PATH
npm bin -g

# Add to ~/.zshrc or ~/.bashrc
export PATH="$PATH:$(npm bin -g)"
```

### "API key not configured"

```bash
# Check your config
cat ~/.freeclaude.json

# Quick fix with setup wizard
freeclaude --setup
```

### "Connection refused" with Ollama

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve

# Check Ollama host
export OLLAMA_HOST=http://localhost:11434
```

### "Cannot find module" errors

```bash
# Rebuild from clean state
rm -rf node_modules bun.lock
cd freeclaude
bun install
bun run build
```

### "Model not found" errors

```bash
# List available models for a provider
/model

# Check provider status
/providers test
```

### Geo-restrictions (403 errors)

Some providers are unavailable from certain regions:

| Region | Blocked Providers | Workaround |
|--------|-------------------|------------|
| 🇷🇺 Russia | Anthropic, OpenAI | Use ZAI, local Ollama |
| 🇨🇳 China | Some US providers | Use ZAI, DeepSeek |
| 🇮🇷 Iran | Most Western APIs | Use local Ollama |

FreeClaude automatically falls back to available providers.

### Permission errors

```bash
# Fix npm permissions (macOS/Linux)
sudo chown -R $(whoami) $(npm config get prefix)/{lib/node_modules,bin,share}

# Or use npx without install
npx @freeclaude/cli
```

---

## Verification

After installation, verify everything works:

```bash
# Check version
freeclaude --version
# Expected: 3.2.6 (FreeClaude)

# Check providers
freeclaude /providers test

# Quick prompt test
freeclaude -p "Hello, what version are you?"
```

---

## Next Steps

- Read [Commands Reference](COMMANDS.md)
- Configure [Memory System](MEMORY.md)
- Set up [Telegram Bot](TELEGRAM.md)
- Learn about [Providers](PROVIDERS.md)
