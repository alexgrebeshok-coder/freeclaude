#!/usr/bin/env node
'use strict';

/**
 * Generate a Homebrew Cask formula for the latest FreeClaude desktop release.
 *
 * Outputs:
 *   <out-dir>/freeclaude.rb
 *
 * Inputs (env or flags):
 *   --version, -v          version to pin (default: desktop/package.json version)
 *   --owner                GitHub owner (default: alexgrebeshok-coder)
 *   --repo                 GitHub repo (default: freeclaude)
 *   --tag-prefix           tag prefix used in releases (default: desktop-v)
 *   --out                  output directory (default: ./out/cask)
 *   --sha256-arm64         pre-computed SHA256 of the arm64 dmg (optional)
 *   --sha256-x64           pre-computed SHA256 of the x64 dmg (optional)
 *
 * If a SHA is omitted, the script writes a `:no_check` placeholder; CI fills the
 * real hash by running `shasum -a 256` after notarisation.
 */

const fs = require('node:fs');
const path = require('node:path');

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

const desktopPkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
);

const version = arg('version', arg('v', desktopPkg.version));
const owner = arg('owner', process.env.GH_RELEASE_OWNER || 'alexgrebeshok-coder');
const repo = arg('repo', process.env.GH_RELEASE_REPO || 'freeclaude');
const tagPrefix = arg('tag-prefix', 'desktop-v');
const outDir = path.resolve(arg('out', path.join(__dirname, '..', 'out', 'cask')));
const arm64Sha = arg('sha256-arm64', ':no_check');
const x64Sha = arg('sha256-x64', ':no_check');

fs.mkdirSync(outDir, { recursive: true });

const tag = `${tagPrefix}${version}`;
const baseUrl = `https://github.com/${owner}/${repo}/releases/download/${tag}`;
const arm64Url = `${baseUrl}/FreeClaude-${version}-arm64.dmg`;
const x64Url = `${baseUrl}/FreeClaude-${version}-x64.dmg`;

const cask = `cask "freeclaude" do
  version "${version}"

  on_arm do
    sha256 ${arm64Sha === ':no_check' ? ':no_check' : `"${arm64Sha}"`}
    url "${arm64Url}",
        verified: "github.com/${owner}/${repo}/"
  end
  on_intel do
    sha256 ${x64Sha === ':no_check' ? ':no_check' : `"${x64Sha}"`}
    url "${x64Url}",
        verified: "github.com/${owner}/${repo}/"
  end

  name "FreeClaude"
  desc "Local-first AI coding workspace — multi-provider, memory, voice, MCP"
  homepage "https://github.com/${owner}/${repo}"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :big_sur"

  app "FreeClaude.app"

  zap trash: [
    "~/Library/Application Support/FreeClaude",
    "~/Library/Logs/FreeClaude",
    "~/Library/Preferences/com.freeclaude.desktop.plist",
    "~/Library/Saved Application State/com.freeclaude.desktop.savedState"
  ]
end
`;

const outPath = path.join(outDir, 'freeclaude.rb');
fs.writeFileSync(outPath, cask);
console.log(`Wrote ${outPath}`);
