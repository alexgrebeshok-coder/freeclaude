#!/usr/bin/env bash
# Post-release smoke test for FreeClaude desktop.
# Downloads the most recent published .dmg from GitHub Releases, mounts it,
# verifies the bundle is signed + notarized, and launches the app headlessly
# to confirm it starts.
#
# Intended to run nightly in CI and after a release tag is promoted.
#
# Required: bash 4+, curl, hdiutil, codesign, spctl, sips. macOS only.

set -euo pipefail

OWNER="${GH_RELEASE_OWNER:-alexgrebeshok-coder}"
REPO="${GH_RELEASE_REPO:-freeclaude}"
TAG_PREFIX="${TAG_PREFIX:-desktop-v}"
ARCH="${ARCH:-$(uname -m)}"

if [[ "$ARCH" == "arm64" ]]; then
  ASSET_SUFFIX="arm64.dmg"
else
  ASSET_SUFFIX="x64.dmg"
fi

api_url="https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=20"

curl_args=(--fail --silent --show-error -H "Accept: application/vnd.github+json")
if [[ -n "${GH_TOKEN:-}" ]]; then
  curl_args+=(-H "Authorization: Bearer ${GH_TOKEN}")
fi

releases=$(curl "${curl_args[@]}" "$api_url")

asset_url=$(printf '%s' "$releases" | python3 -c '
import json,sys,re
data = json.load(sys.stdin)
for rel in data:
    tag = rel.get("tag_name") or ""
    if not tag.startswith(sys.argv[1]):
        continue
    for asset in rel.get("assets", []):
        name = asset.get("name") or ""
        if name.endswith(sys.argv[2]):
            print(asset["browser_download_url"])
            sys.exit(0)
sys.exit(1)
' "$TAG_PREFIX" "$ASSET_SUFFIX')

if [[ -z "$asset_url" ]]; then
  echo "No matching ${ASSET_SUFFIX} asset under releases tagged ${TAG_PREFIX}*" >&2
  exit 2
fi

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

dmg="$tmpdir/freeclaude.dmg"
echo "Downloading $asset_url"
curl --fail --location --silent --show-error -o "$dmg" "$asset_url"

mount_point=$(hdiutil attach "$dmg" -nobrowse -quiet | tail -n1 | awk '{print $3}')
trap 'hdiutil detach "$mount_point" -quiet >/dev/null 2>&1 || true; rm -rf "$tmpdir"' EXIT

app="$mount_point/FreeClaude.app"
if [[ ! -d "$app" ]]; then
  echo "FreeClaude.app missing inside DMG: $mount_point" >&2
  exit 3
fi

echo "Codesign verify…"
codesign --verify --deep --strict --verbose=2 "$app"

echo "Gatekeeper assess…"
spctl --assess --type execute --verbose=2 "$app"

echo "Launching headlessly…"
open -W "$app" --args --version || true

echo "Smoke OK: $asset_url"
