#!/bin/bash
# FreeClaude Launcher
# Проверяет env vars и запускает с правильными настройками

set -e

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Проверка API ключа
check_api_key() {
  if [ -z "$OPENAI_API_KEY" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
    echo -e "${RED}❌ API key not configured${NC}"
    echo ""
    echo "Setup options:"
    echo "  1. Run: ./scripts/setup.sh"
    echo "  2. Or set environment variables:"
    echo "     export OPENAI_API_KEY=your-key"
    echo "     export OPENAI_BASE_URL=https://api.z.ai/api/coding/paas/v4"
    echo "     export OPENAI_MODEL=glm-4.7-flash"
    echo ""
    echo "Supported providers:"
    echo "  • ZAI (free for RF)"
    echo "  • DeepSeek"
    echo "  • Gemini"
    echo "  • Ollama (local)"
    exit 1
  fi
}

# Вывод информации о провайдере
show_provider_info() {
  if [ -n "$OPENAI_API_KEY" ]; then
    MODEL="${OPENAI_MODEL:-gpt-4o-mini}"
    BASE="${OPENAI_BASE_URL:-https://api.openai.com/v1}"
    echo -e "${GREEN}✅ Provider: OpenAI-compatible${NC}" >&2
    echo -e "  Model: $MODEL" >&2
    echo -e "  Base URL: $BASE" >&2
  elif [ -n "$ANTHROPIC_API_KEY" ]; then
    echo -e "${GREEN}✅ Provider: Anthropic${NC}" >&2
  fi
}

# Установка переменных для OpenAI-compatible режима
setup_openai_mode() {
  if [ -n "$OPENAI_API_KEY" ]; then
    export CLAUDE_CODE_USE_OPENAI=1
    # Anthropic SDK будет использовать OPENAI_* переменные
  fi
}

# Главная функция
main() {
  check_api_key
  show_provider_info
  setup_openai_mode

  # Запуск FreeClaude
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  node "$SCRIPT_DIR/freeclaude" "$@"
}

main "$@"
