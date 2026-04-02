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
