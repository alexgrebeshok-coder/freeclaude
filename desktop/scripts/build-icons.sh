#!/bin/bash

# FreeClaude Desktop Icon Builder
# Converts SVG to PNG and ICNS for macOS

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="${SCRIPT_DIR}/../assets"

echo "Building FreeClaude Desktop icons..."

# Check for required tools
if ! command -v sips &> /dev/null; then
    echo "Error: sips not found (macOS only script)"
    exit 1
fi

# Create temporary directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Generate PNG icon from SVG
if command -v rsvg-convert &> /dev/null; then
    rsvg-convert -w 512 -h 512 "${ASSETS_DIR}/logo.svg" -o "${ASSETS_DIR}/icon.png"
elif command -v convert &> /dev/null; then
    convert "${ASSETS_DIR}/logo.svg" -resize 512x512 "${ASSETS_DIR}/icon.png"
else
    # Fallback: create a simple icon using sips (requires existing image)
    echo "Warning: Using existing PNG or creating placeholder"
fi

# Generate ICNS for macOS
mkdir -p "${TEMP_DIR}/icon.iconset"

# Generate different sizes
SIZES=(16 32 64 128 256 512)
for SIZE in "${SIZES[@]}"; do
    # Normal resolution
    sips -z $SIZE $SIZE "${ASSETS_DIR}/icon.png" --out "${TEMP_DIR}/icon.iconset/icon_${SIZE}x${SIZE}.png" 2>/dev/null || true
    # Retina (@2x)
    DOUBLE=$((SIZE * 2))
    if [ $DOUBLE -le 1024 ]; then
        sips -z $DOUBLE $DOUBLE "${ASSETS_DIR}/icon.png" --out "${TEMP_DIR}/icon.iconset/icon_${SIZE}x${SIZE}@2x.png" 2>/dev/null || true
    fi
done

# Create ICNS file
if command -v iconutil &> /dev/null; then
    iconutil -c icns "${TEMP_DIR}/icon.iconset" -o "${ASSETS_DIR}/icon.icns"
    echo "Created icon.icns"
else
    echo "Warning: iconutil not available, skipping ICNS creation"
fi

echo "Icon build complete!"
echo "  - ${ASSETS_DIR}/icon.png"
echo "  - ${ASSETS_DIR}/icon.icns"
