import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION_PATTERN = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/
const VERSION_INPUT_PATTERN = new RegExp(`^${VERSION_PATTERN.source}$`)

const JSON_VERSION_FILES = [
  'package.json',
  join('desktop', 'package.json'),
  join('desktop', 'src-tauri', 'tauri.conf.json'),
  join('extension', 'package.json'),
]

export type SyncVersionResult = {
  path: string
  status: 'updated' | 'unchanged' | 'skipped'
}

function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

function writeText(path: string, value: string): void {
  writeFileSync(path, value, 'utf8')
}

function replaceOrThrow(
  source: string,
  matcher: RegExp,
  replacement: string | ((substring: string, ...args: string[]) => string),
  label: string,
): string {
  const lookup = new RegExp(matcher.source, matcher.flags)
  if (!lookup.test(source)) {
    throw new Error(`Unable to update ${label}`)
  }
  return source.replace(matcher, replacement as never)
}

function updateJsonVersionFile(
  repoRoot: string,
  relativePath: string,
  version: string,
): SyncVersionResult {
  const path = join(repoRoot, relativePath)
  const raw = readText(path)
  const parsed = JSON.parse(raw) as Record<string, unknown>

  if (parsed.version === version) {
    return { path: relativePath, status: 'unchanged' }
  }

  parsed.version = version
  writeText(path, JSON.stringify(parsed, null, 2) + '\n')
  return { path: relativePath, status: 'updated' }
}

export function replaceReadmeVersionBadge(
  source: string,
  version: string,
): string {
  return replaceOrThrow(
    source,
    /\[!\[v[^\]]+\]\(https:\/\/img\.shields\.io\/badge\/version-[^)]+?-brightgreen\)\]\(([^)]+)\)/,
    (_substring, releaseUrl) =>
      `[![v${version}](https://img.shields.io/badge/version-${version}-brightgreen)](${releaseUrl})`,
    'README badge',
  )
}

export function replaceCliDisplayVersion(
  source: string,
  version: string,
): string {
  return replaceOrThrow(
    source,
    new RegExp(`${VERSION_PATTERN.source}(?= \\(FreeClaude\\))`, 'g'),
    version,
    'dist/cli.mjs',
  )
}

export function replaceVoicePipelineVersionAssertions(
  source: string,
  version: string,
): string {
  let next = replaceOrThrow(
    source,
    new RegExp(`cli\\.mjs contains ${VERSION_PATTERN.source}`),
    `cli.mjs contains ${version}`,
    'voice-pipeline test name',
  )
  next = replaceOrThrow(
    next,
    new RegExp(`toContain\\('${VERSION_PATTERN.source}'\\)`),
    `toContain('${version}')`,
    'voice-pipeline version assertion',
  )
  return next
}

function updateTextSurface(
  repoRoot: string,
  relativePath: string,
  transform: (source: string, version: string) => string,
  version: string,
): SyncVersionResult {
  const path = join(repoRoot, relativePath)
  if (!existsSync(path)) {
    return { path: relativePath, status: 'skipped' }
  }

  const current = readText(path)
  const next = transform(current, version)
  if (next === current) {
    return { path: relativePath, status: 'unchanged' }
  }

  writeText(path, next)
  return { path: relativePath, status: 'updated' }
}

export function parseOptions(argv: string[]): { version: string } {
  const version = argv[0]?.trim()
  if (!version) {
    throw new Error('Usage: bun run scripts/sync-version.ts <version>')
  }
  if (!VERSION_INPUT_PATTERN.test(version)) {
    throw new Error(`Invalid version: ${version}`)
  }
  return { version }
}

export function syncVersion(
  repoRoot: string,
  version: string,
): SyncVersionResult[] {
  const results = JSON_VERSION_FILES.map(relativePath =>
    updateJsonVersionFile(repoRoot, relativePath, version),
  )

  results.push(
    updateTextSurface(repoRoot, 'README.md', replaceReadmeVersionBadge, version),
  )
  results.push(
    updateTextSurface(
      repoRoot,
      join('dist', 'cli.mjs'),
      replaceCliDisplayVersion,
      version,
    ),
  )
  results.push(
    updateTextSurface(
      repoRoot,
      join('src', 'services', 'voice', 'voice-pipeline.test.ts'),
      replaceVoicePipelineVersionAssertions,
      version,
    ),
  )

  return results
}

function isDirectExecution(moduleUrl: string): boolean {
  const invokedPath = process.argv[1]
  if (!invokedPath) {
    return false
  }
  return resolve(invokedPath) === resolve(fileURLToPath(moduleUrl))
}

function main(): void {
  const { version } = parseOptions(process.argv.slice(2))
  const results = syncVersion(process.cwd(), version)

  console.log(`Version sync complete: ${version}`)
  for (const result of results) {
    console.log(`- ${result.status}: ${result.path}`)
  }
}

if (isDirectExecution(import.meta.url)) {
  main()
}
