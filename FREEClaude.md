# FreeClaude - Бесплатный Claude Code для всех

> Форк OpenClaude без OAuth авторизации

FreeClaude работает с любыми OpenAI-compatible API провайдерами.

## Возможности

Все возможности Claude Code:
- Код, рефакторинг
- Файловая операции
- Shell команды
- Subagents
- MCP support

- Context management

## Установка

```bash
git clone https://github.com/freeclaude/freeclaude
cd freeclaude
bun install
bun run build
```

**Быстрый старт:**

```bash
# macOS/Linux
./install-freeclaude.sh
source ~/.zshrc  # или ~/.bashrc
freeclaude
```

**Windows (PowerShell):**
```powershell
# Download from https://github.com/freeclaude/freeclaude
./install-freeclaude.ps1
```

**Already installed?** Then skip Oollama setup.
```

**И DeepSeek** (optional)
  ```bash
# Set API key
export OPENAI_API_KEY="your-key-here"

# ZAI (free for RF)
export OPENAI_API_KEY="07b98bdc1bcf4701aa0ec63a55a2e1aa.IonFMBpmLlTFf1U7"
export OPENAI_BASE_URL="https://api.z.ai/api/coding/paas/v4"
export OPENAI_MODEL="glm-4.7-flash"
```

**Option 2: Qwen Code (OAuth)**
```bash
qwen auth  # Follow browser flow
```

**Option 3: DeepSeek**
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
export OPENAI_MODEL="deepseek-chat"
```

**Option 4: Gemini**
export OPENAI_API_KEY="AIza..."
export OPENAI_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
export OPENAI_MODEL="gemini-2.0-flash"
```

**Option 5: Ollama (Local)**
export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_MODEL="llama3.2"
ollama pull llama3.2
```

**Option 6: Custom**
# Edit OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL
# according to your provider's API

```

**ЗAI** (рекомендуется)
- 1000 запросов/день бесплатно
- Qwen: OAuth авторизация (1000/день)
- DeepSeek: платно, но дешево
- Gemini: бесплатный 15 RPM
- Ollama: бесплатно локально

- OpenAI: платно

- Any OpenAI-compatible API

- Custom settings, callbacks

- Fallback chain

- Simple setup
- MIT license

## Автор

👤 **Сste** — создатель freeclaude

🏠 **GitHub:** https://github.com/freeclaude/freeclaude
