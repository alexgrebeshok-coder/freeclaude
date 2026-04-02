# FreeClaude - Бесплатный Claude Code для всех

> Форк OpenClaude без OAuth авторизации

FreeClaude работает с любыми OpenAI-compatible API провайдерами.

## Возможности

Все возможности Claude Code:
- ✅ Код, рефакторинг, багфикс
- ✅ Файловые операции
- ✅ Shell команды
- ✅ Subagents (параллельные задачи)
- ✅ Web search
- ✅ MCP support
- ✅ Context management

**Бесплатно навсегда** с OpenAI-compatible провайдерами.

## Установка

```bash
# Клонировать репозиторий
git clone https://github.com/freeclaude/freeclaude
cd freeclaude

# Установить зависимости
bun install

# Собрать
bun run build

# Добавить алиас
echo "alias fc='~/.openclaw/workspace/tools/freeclaude.sh'" >> ~/.zshrc
source ~/.zshrc
```

## Быстрый старт

### Вариант 1: ZAI (бесплатно для РФ)

```bash
# Скопировать .env файл
cp freeclaude/.env.zai ~/.zshrc

# Или добавить вручную:
export OPENAI_API_KEY="07b98bdc1bcf4701aa0ec63a55a2e1aa.IonFMBpmLlTFf1U7"
export OPENAI_BASE_URL="https://api.z.ai/api/coding/paas/v4"
export OPENAI_MODEL="glm-4.7-flash"

# Запустить
fc "Напиши Hello World на Python"
```

### Вариант 2: DeepSeek

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
export OPENAI_MODEL="deepseek-chat"
```

### Вариант 3: Gemini (бесплатно 15 RPM)

```bash
export OPENAI_API_KEY="AIza..."
export OPENAI_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
export OPENAI_MODEL="gemini-2.0-flash"
```

### Вариант 4: Ollama (локально)

```bash
# Установить Ollama: https://ollama.com
ollama pull llama3.2

export OPENAI_API_KEY="ollama"
export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_MODEL="llama3.2"
```

### Вариант 5: OpenAI

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_MODEL="gpt-4o"
```

## Использование

```bash
# Интерактивный режим
fc

# Быстрый вопрос
fc "Объясни что такое Rust"

# Работа с файлами
fc src/main.py

# Diff режим
fc --diff old.py new.py

# С проектом
fc --project ./myapp

# Print mode (для скриптов)
fc -p "Создай README.md"
```

## Провайдеры

| Провайдер | Цена | Лимит | Рекомендация |
|-----------|------|-------|--------------|
| **ZAI** | Бесплатно | Безлимит* | ✅ РФ |
| **Qwen Code** | Бесплатно | 1000/день | ✅ OAuth |
| **DeepSeek** | $0.14/1M | Безлимит | ✅ Дёшево |
| **Gemini** | Бесплатно | 15 RPM | ✅ Google |
| **Ollama** | Бесплатно | Безлимит | ✅ Локально |
| **OpenAI** | $2.50/1M | Безлимит | ⚠️ Дорого |

## Особенности FreeClaude

- ❌ **Без OAuth** — только API key
- ✅ **Fallback chain** — переключение провайдеров
- ✅ **Простая настройка** — 3 env vars
- ✅ **Любой OpenAI-compatible API**
- ✅ **Open source** — MIT license

## Fallback Chain

Автоматическое переключение между провайдерами:

```bash
# Приоритет:
1. ZAI (РФ)
2. DeepSeek (дёшево)
3. Gemini (бесплатно)
4. Ollama (локально)
```

## Troubleshooting

**"OPENAI_API_KEY not set"**
```bash
export OPENAI_API_KEY="your-key-here"
source ~/.zshrc
```

**"Not logged in"**
```bash
# Убедитесь что CLAUDE_CODE_USE_OPENAI=1
export CLAUDE_CODE_USE_OPENAI=1
```

**"Invalid API key"**
- Проверьте правильность API key
- Убедитесь что BASE_URL правильный
- Проверьте баланс (для платных провайдеров)

## Разработка

```bash
# Клонировать
git clone https://github.com/freeclaude/freeclaude
cd freeclaude

# Установить
bun install

# Разработка
bun run dev

# Сборка
bun run build

# Тест
bun test
```

## Roadmap

- [x] OpenAI-compatible API support
- [x] ZAI integration
- [x] DeepSeek integration
- [x] Gemini integration
- [x] Ollama integration
- [ ] Fallback chain (auto-switch)
- [ ] Provider wizard (setup)
- [ ] Token counter
- [ ] Cost calculator
- [ ] Usage analytics

## Авторы

- **OpenClaude Team** — оригинальный код
- **FreeClaude Community** — модификации

## Лицензия

MIT

---

**GitHub:** https://github.com/freeclaude/freeclaude
**Документация:** https://docs.freeclaude.ai
**Discord:** https://discord.gg/freeclaude

---

## 🔧 Provider Status

### ✅ Working
- **ZAI (glm-4.7-flash)**: ✅ Works, free for RF, fast (5-10s), good Russian

### ⏸️ Requires Setup
- **DeepSeek**: Needs API key → https://platform.deepseek.com
- **Gemini**: Needs API key → https://aistudio.google.com/apikey
- **Ollama**: Needs installation → `brew install ollama`

### 📋 Provider Comparison

| Provider | Price | Speed | Russian | Setup |
|----------|-------|-------|---------|-------|
| **ZAI** | Free | ⚡ Fast | ✅ Native | ✅ Ready |
| **DeepSeek** | $0.14/M | ⚡ Fast | ✅ Good | ⏸️ API Key |
| **Gemini** | Free (15 RPM) | ⚡ Fast | ⚠️ OK | ⏸️ API Key |
| **Ollama** | Free | 🐢 Local | ✅ Good | ⏸️ Install |

### 🚀 Quick Switch Provider

```bash
# ZAI (default, free for RF)
source ~/.openclaw/workspace/freeclaude/.env.zai

# DeepSeek (cheap, high quality)
source ~/.openclaw/workspace/freeclaude/.env.deepseek

# Gemini (free tier)
source ~/.openclaw/workspace/freeclaude/.env.gemini

# Ollama (local)
source ~/.openclaw/workspace/freeclaude/.env.ollama
```
