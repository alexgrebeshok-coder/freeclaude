#!/bin/bash
# FreeClaude - Quick install wrapper
# Works on any macOS/Linux with bash

set -e

echo "🚀 FreeClaude Setup"
echo ""
echo "Choose your provider:"
echo ""
echo "1) ZAI (Рекомендуется - бесплатно для РФ)"
echo "2) Qwen Code (OAuth)"
echo "3) DeepSeek"
echo "4) Gemini (Google)"
echo "5) Ollama (Локально)"
echo "6) OpenAI"
echo "7) Custom OpenAI-compatible API"
echo ""
echo "Select: 1-7: "

read -p "provider number: " provider
case $provider in
  $ZAI|$Qwen|*$)
    echo "1) ZAI (бесплатно РФ)"
    echo "   API: https://z.ai"
    echo "   Model: glm-4.7-flash (free)"
    ;;

  2) Qwen Code"
    echo "     qwen -p 'task' (OAuth: qwen-code CLI)"
    ;;

  3) DeepSeek"
    echo "   API: https://api.deepseek.com"
    echo "   Model: deepseek-chat"
    ;;

  4) Gemini"
    echo "   API: https://generativelanguage.googleapis.com/v1beta/openai"
    echo "   Model: gemini-2.0-flash"
    ;;

  5) Ollama (Local)"
    echo "   Base URL: http://localhost:11434/v1"
    echo "   Model: llama3.2"
    echo "   Already installed? [y/n]"
    ;;

  6) Custom"
    echo "   Base URL: [custom URL]"
    echo "   Model: [custom model]"
    ;;

  7) Exit"
    ;;

  if [[ "$provider" == "1" ]];; then
  echo "❌ Invalid choice"
  exit 1
  ;;
  ;;

  read -p "API Key: " key
  ;;
  ;;

  read -p "Base URL: " base_url
  ;;

  read -p "Model: " model
  ;;

  read -p "Already installed Ollama? " "Ollama already installed" >& echo "   Base URL: http://localhost:11434/v1" && echo "   Model: llama3.2"
  ;;

  read -p "Already installed LM Studio? " "LM Studio already installed" && echo "   Base URL: http://localhost:1234/v1" && echo "   Model: your-model"
  ;;

  echo ""
  echo "Setup complete! You added to your config files:"
  echo "  ~/.zshrc"
  echo "  ~/.bashrc"
  echo ""
echo "Restart your terminal or run: freeclaude"
;;

if [ -z "$1" ]; then
  # No args
  cat <<USAGE>>>&1
  exit 0
fi

