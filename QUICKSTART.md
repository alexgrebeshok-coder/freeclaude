# FreeClaude Quick Start

## 5 минут до запуска

### 1. Установка

```bash
git clone https://github.com/freeclaude/freeclaude
cd freeclaude
bun install
bun run build
```

### 2. Настройка API

**Вариант A: Автоматически (Рекомендуется)**

```bash
./scripts/setup.sh
# Выберите провайдера, введите API ключ
source ~/.zshrc  # или ~/.bashrc
```

**Вариант B: Вручную**

```bash
# ZAI (бесплатно для РФ)
export OPENAI_API_KEY="your-zai-key"
export OPENAI_BASE_URL="https://api.z.ai/api/coding/paas/v4"
export OPENAI_MODEL="glm-4.7-flash"

# DeepSeek
export OPENAI_API_KEY="your-deepseek-key"
export OPENAI_BASE_URL="https://api.deepseek.com/v1"
export OPENAI_MODEL="deepseek-chat"

# Ollama (локально, бесплатно)
ollama pull llama3.2
export OPENAI_API_KEY="ollama"
export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_MODEL="llama3.2"
```

### 3. Запуск

```bash
# Интерактивный режим
freeclaude

# Быстрый вопрос
freeclaude -p "Объясни что такое Rust"

# Работа с файлами
freeclaude src/main.py

# Diff режим
freeclaude --diff old.py new.py
```

### 4. Fallback Chain (опционально)

Если основной провайдер недоступен:

```bash
# Основной
export OPENAI_API_KEY="zai-key"
export OPENAI_BASE_URL="https://api.z.ai/api/coding/paas/v4"
export OPENAI_MODEL="glm-4.7-flash"

# Fallback 1
export FALLBACK_API_KEY="deepseek-key"
export FALLBACK_BASE_URL="https://api.deepseek.com/v1"
export FALLBACK_MODEL="deepseek-chat"

# Fallback 2 (локальный)
export FALLBACK2_API_KEY="ollama"
export FALLBACK2_BASE_URL="http://localhost:11434/v1"
export FALLBACK2_MODEL="llama3.2"
```

## Готово!

Теперь у вас есть бесплатный Claude Code с любыми моделями.

### Полезные команды

```bash
fc                    # Короткий алиас
fc -p "вопрос"        # Быстрый вопрос
fc file.py            # Работа с файлом
fc --help             # Справка
```

### Troubleshooting

**"API key not configured"**
→ Проверьте env vars: `echo $OPENAI_API_KEY`

**"Cannot connect to API"**
→ Проверьте BASE_URL и интернет

**"Model not found"**
→ Проверьте название модели в OPENAI_MODEL
