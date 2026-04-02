#!/bin/bash
# FreeClaude Setup Wizard
# Помогает настроить API ключ

set -e

echo "🚀 FreeClaude Setup"
echo ""
echo "Choose your provider:"
echo ""
echo "1) ZAI (Рекомендуется - бесплатно для РФ)"
echo "2) OpenAI"
echo "3) DeepSeek"
echo "4) Gemini (Google)"
echo "5) Ollama (Локально)"
echo "6) Custom (OpenAI-compatible)"
echo ""

read -p "Выбор [1-6]: " choice

case $choice in
  1)
    echo ""
    echo "ZAI Setup"
    echo "---------"
    echo "Получите API ключ: https://z.ai"
    read -p "API ключ: " api_key
    echo ""
    echo "export OPENAI_API_KEY=\"$api_key\"" >> ~/.zshrc
    echo "export OPENAI_BASE_URL=\"https://api.z.ai/api/coding/paas/v4\"" >> ~/.zshrc
    echo "export OPENAI_MODEL=\"glm-4.7-flash\"" >> ~/.zshrc
    echo "✅ Добавлено в ~/.zshrc"
    ;;
  2)
    echo ""
    echo "OpenAI Setup"
    echo "------------"
    read -p "API ключ: " api_key
    read -p "Модель [gpt-4o-mini]: " model
    model=${model:-gpt-4o-mini}
    echo ""
    echo "export OPENAI_API_KEY=\"$api_key\"" >> ~/.zshrc
    echo "export OPENAI_MODEL=\"$model\"" >> ~/.zshrc
    echo "✅ Добавлено в ~/.zshrc"
    ;;
  3)
    echo ""
    echo "DeepSeek Setup"
    echo "--------------"
    read -p "API ключ: " api_key
    echo ""
    echo "export OPENAI_API_KEY=\"$api_key\"" >> ~/.zshrc
    echo "export OPENAI_BASE_URL=\"https://api.deepseek.com/v1\"" >> ~/.zshrc
    echo "export OPENAI_MODEL=\"deepseek-chat\"" >> ~/.zshrc
    echo "✅ Добавлено в ~/.zshrc"
    ;;
  4)
    echo ""
    echo "Gemini Setup"
    echo "------------"
    echo "Получите API ключ: https://aistudio.google.com/apikey"
    read -p "API ключ: " api_key
    echo ""
    echo "export OPENAI_API_KEY=\"$api_key\"" >> ~/.zshrc
    echo "export OPENAI_BASE_URL=\"https://generativelanguage.googleapis.com/v1beta/openai\"" >> ~/.zshrc
    echo "export OPENAI_MODEL=\"gemini-2.0-flash\"" >> ~/.zshrc
    echo "✅ Добавлено в ~/.zshrc"
    ;;
  5)
    echo ""
    echo "Ollama Setup"
    echo "------------"
    echo "Убедитесь, что Ollama запущен: ollama serve"
    read -p "Модель [llama3.2]: " model
    model=${model:-llama3.2}
    echo ""
    echo "export OPENAI_API_KEY=\"ollama\"" >> ~/.zshrc
    echo "export OPENAI_BASE_URL=\"http://localhost:11434/v1\"" >> ~/.zshrc
    echo "export OPENAI_MODEL=\"$model\"" >> ~/.zshrc
    echo "✅ Добавлено в ~/.zshrc"
    ;;
  6)
    echo ""
    echo "Custom Provider"
    echo "---------------"
    read -p "API ключ: " api_key
    read -p "Base URL: " base_url
    read -p "Модель: " model
    echo ""
    echo "export OPENAI_API_KEY=\"$api_key\"" >> ~/.zshrc
    echo "export OPENAI_BASE_URL=\"$base_url\"" >> ~/.zshrc
    echo "export OPENAI_MODEL=\"$model\"" >> ~/.zshrc
    echo "✅ Добавлено в ~/.zshrc"
    ;;
  *)
    echo "❌ Неверный выбор"
    exit 1
    ;;
esac

echo ""
echo "Перезапустите терминал или выполните:"
echo "  source ~/.zshrc"
echo ""
echo "Затем запустите:"
echo "  freeclaude"
