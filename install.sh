#!/usr/bin/env bash
set -euo pipefail

# FreeClaude Desktop — macOS install script
# Usage: curl -fsSL https://raw.githubusercontent.com/alexgrebeshok-coder/freeclaude/main/install.sh | bash

REPO="alexgrebeshok-coder/freeclaude"
APP_NAME="FreeClaude"
TMP_MOUNT="/tmp/freeclaude-install"
INSTALL_DIR="/Applications"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}⬇️  FreeClaude Desktop — установка${NC}"
echo ""

# Check macOS
if [[ "$(uname)" != "Darwin" ]]; then
  echo -e "${RED}❌ Этот скрипт только для macOS${NC}"
  exit 1
fi

# Check arch
ARCH="arm64"
if [[ "$(uname -m)" != "arm64" ]]; then
  ARCH="x64"
  echo "ℹ️  Intel Mac — загрузка x64 версии"
fi

# Get latest release URL
echo "🔍 Ищем последнюю версию..."
LATEST_URL=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep "browser_download_url.*FreeClaude.*dmg" | head -1 | cut -d'"' -f4)

if [[ -z "$LATEST_URL" ]]; then
  echo -e "${RED}❌ Не удалось найти DMG в последнем релизе${NC}"
  echo "   Проверь: https://github.com/${REPO}/releases/latest"
  exit 1
fi

VERSION=$(echo "$LATEST_URL" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' || echo "latest")
echo "📦 Версия: ${VERSION}"
echo "🔗 ${LATEST_URL}"

# Download
echo ""
echo "⬇️  Скачиваю..."
DMG_PATH="/tmp/${APP_NAME}-${VERSION}.dmg"
curl -fSL -# -o "$DMG_PATH" "$LATEST_URL"
echo ""

# Close existing app
if pgrep -q "${APP_NAME}"; then
  echo "🛑 Закрываю запущенное приложение..."
  killall "${APP_NAME}" 2>/dev/null || true
  sleep 1
fi

# Remove old version
if [[ -d "${INSTALL_DIR}/${APP_NAME}.app" ]]; then
  echo "🗑️  Удаляю старую версию..."
  rm -rf "${INSTALL_DIR}/${APP_NAME}.app"
fi

# Mount DMG
echo "📀 Монтирую образ..."
rm -rf "$TMP_MOUNT"
mkdir -p "$TMP_MOUNT"
hdiutil attach "$DMG_PATH" -mountpoint "$TMP_MOUNT" -nobrowse -quiet

# Copy to Applications
echo "📋 Копирую в Applications..."
cp -R "${TMP_MOUNT}/${APP_NAME}.app" "${INSTALL_DIR}/"

# Unmount
hdiutil detach "$TMP_MOUNT" -quiet
rm -rf "$TMP_MOUNT"
rm -f "$DMG_PATH"

# Launch
echo "🚀 Запускаю..."
open "${INSTALL_DIR}/${APP_NAME}.app"

echo ""
echo -e "${GREEN}✅ FreeClaude Desktop установлен!${NC}"
echo "   Приложение в папке Applications и уже запущено."
echo ""
echo "   Следующий раз просто открой из Launchpad или Spotlight (⌘Пробел → FreeClaude)."
