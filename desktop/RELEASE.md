# FreeClaude Desktop — Release Pipeline

## Cadence

- The desktop app and the CLI ship from the same monorepo.
  `desktop/package.json` always tracks the version of the root
  `package.json`. Run `npm run version:sync` (or check it with
  `npm run version:sync:check`) before tagging.
- Public desktop releases use the tag prefix `desktop-v<version>` so they do
  not collide with the npm tags published by the CLI release workflow.

## One-time setup (per maintainer machine)

1. Install Apple Developer ID Application certificate into the local
   keychain (login).
2. Generate an [app-specific password](https://account.apple.com) for
   notarization.
3. Export the following secrets into the GitHub repository **Settings →
   Secrets and variables → Actions** so that the `Sign + Notarize +
   Publish` job in `.github/workflows/desktop.yml` can run:
   - `APPLE_SIGNING_IDENTITY` — e.g. `Developer ID Application: <Org Name> (<TEAMID>)`
   - `APPLE_ID` — Apple ID email used for notarization
   - `APPLE_APP_SPECIFIC_PASSWORD`
   - `APPLE_TEAM_ID`
   - `APPLE_CERTIFICATE_BASE64` — `base64 < developer-id.p12`
   - `APPLE_CERTIFICATE_PASSWORD`

## Cutting a release

```bash
# 1. Bump the version in the root package.json (or wait for a CLI release).
#    Then sync desktop/package.json.
npm --prefix desktop run version:sync

# 2. Verify everything is green.
npm --prefix desktop run lint
npm --prefix desktop run typecheck
npm --prefix desktop test -- --run
npm --prefix desktop run make    # smoke build, unsigned

# 3. Tag and push.
git tag desktop-v$(node -p "require('./desktop/package.json').version")
git push --tags
```

GitHub Actions picks up the `desktop-v*` tag, runs the matrix CI, then the
`release` job:

1. Imports the signing certificate into a temporary keychain.
2. Builds the universal arm64+x64 `.app`, signs it with hardened runtime,
   notarizes via Apple, staples the ticket, then packages `.dmg` and `.zip`.
3. Uses `@electron-forge/publisher-github` to publish the artifacts as a
   draft GitHub Release.

Promote the draft to a public release once a maintainer has verified it
locally.

## Distribution

- **GitHub Releases** is the primary channel. URLs:
  - `https://github.com/<owner>/<repo>/releases/download/desktop-v<version>/FreeClaude-<version>-arm64.dmg`
  - `https://github.com/<owner>/<repo>/releases/download/desktop-v<version>/FreeClaude-<version>-x64.dmg`
- **Homebrew Cask**: ship the formula via the `homebrew-freeclaude` tap.
  After a release is promoted, run:

  ```bash
  npm --prefix desktop run cask:generate -- \
    --version <version> \
    --sha256-arm64 $(shasum -a 256 FreeClaude-<version>-arm64.dmg | awk '{print $1}') \
    --sha256-x64 $(shasum -a 256 FreeClaude-<version>-x64.dmg | awk '{print $1}')
  ```

  Copy `desktop/out/cask/freeclaude.rb` into the tap repo's `Casks/` folder
  and open a PR. Users can then `brew install --cask alexgrebeshok-coder/freeclaude/freeclaude`.

## Auto-update

The packaged app uses `electron-updater` against the GitHub Releases feed.
Updates are checked on app start and every 4 hours while the app is open.
The renderer surfaces "Restart to update" via the `updater:status` IPC event.
Disable auto-update in `Settings → Updates` (default: on).

## Post-release smoke

`desktop/scripts/post-release-check.sh` runs nightly (and after each tag):

- Downloads the latest published `.dmg` matching `${ARCH}.dmg`.
- Verifies `codesign --verify --deep --strict` and `spctl --assess`.
- Mounts and launches the app once with `--version` to ensure it starts.

If any step fails the workflow opens a GitHub issue tagged
`release-smoke` so a maintainer can investigate before broader rollout.

## Rollback

If a release is broken:

1. Edit the GitHub Release to mark it as a draft (so the auto-update feed
   ignores it).
2. Re-tag the previous good build as `desktop-vX.Y.Z-rollback` if needed.
3. Investigate, fix, bump the patch version and re-cut.
