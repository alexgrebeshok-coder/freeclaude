import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

type VersionCheck = {
  label: string
  ok: boolean
  details: string
}

const repoRoot = process.cwd()

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

const rootPackage = readJson(join(repoRoot, 'package.json')) as { version: string }
const desktopPackage = readJson(join(repoRoot, 'desktop', 'package.json')) as {
  version: string
}
const tauriConfig = readJson(
  join(repoRoot, 'desktop', 'src-tauri', 'tauri.conf.json'),
) as { version: string }
const extensionPackage = readJson(
  join(repoRoot, 'extension', 'package.json'),
) as { version: string }
const readme = readText(join(repoRoot, 'README.md'))
const expectedVersion = rootPackage.version

const checks: VersionCheck[] = [
  {
    label: 'root package.json',
    ok: rootPackage.version === expectedVersion,
    details: rootPackage.version,
  },
  {
    label: 'desktop/package.json',
    ok: desktopPackage.version === expectedVersion,
    details: desktopPackage.version,
  },
  {
    label: 'desktop/src-tauri/tauri.conf.json',
    ok: tauriConfig.version === expectedVersion,
    details: tauriConfig.version,
  },
  {
    label: 'extension/package.json',
    ok: extensionPackage.version === expectedVersion,
    details: extensionPackage.version,
  },
  {
    label: 'README version badge',
    ok:
      readme.includes(`[![v${expectedVersion}]`) &&
      readme.includes(`version-${expectedVersion}-`),
    details: `expected badge for ${expectedVersion}`,
  },
]

const cliEntryPath = join(repoRoot, 'dist', 'cli.mjs')
if (existsSync(cliEntryPath)) {
  const cliEntry = readText(cliEntryPath)
  checks.push({
    label: 'dist/cli.mjs',
    ok: cliEntry.includes(`${expectedVersion} (FreeClaude)`),
    details: `expected ${expectedVersion} (FreeClaude)`,
  })
}

const failed = checks.filter(check => !check.ok)

if (failed.length > 0) {
  console.error(`Version truth check failed for ${failed.length} surface(s):`)
  for (const check of failed) {
    console.error(`- ${check.label}: ${check.details}`)
  }
  process.exit(1)
}

console.log(`Version truth OK: ${expectedVersion}`)
for (const check of checks) {
  console.log(`- ${check.label}`)
}
