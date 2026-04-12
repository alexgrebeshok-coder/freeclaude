import { readdir, readFile, stat } from 'fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'path'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { findGitRoot, gitExe } from '../../utils/git.js'
import { parseGitCommitId, trackGitOperations } from '../shared/gitOperationTracking.js'

const MAX_GIT_CONTEXT_STATUS_CHARS = 2_000
const DEFAULT_RECENT_COMMIT_COUNT = 5
const DEFAULT_DIFF_CHARS = 24_000
const DEFAULT_REPO_MAP_DEPTH = 4
const DEFAULT_REPO_MAP_ENTRIES = 400
const MAX_EXPORT_BYTES = 64 * 1024
const REPO_MAP_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.idea',
  '.vscode',
])
const EXPORTABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
])

export type GitContextSnapshot = {
  branch: string
  status: string
  recentCommits: string
}

export type GitCommandOutput = {
  success: boolean
  output: string
}

export type AutoCommitResult = {
  committed: boolean
  sha?: string
  message?: string
  output?: string
  reason?: string
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  return `${text.slice(0, maxChars)}\n... (truncated)`
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function normalizeRepoPath(root: string, filePath: string): string | null {
  const absolutePath = resolve(filePath)
  const relativePath = relative(root, absolutePath)
  if (
    relativePath === '' ||
    relativePath === '.' ||
    relativePath.startsWith('..')
  ) {
    return null
  }
  return relativePath
}

async function runGitInRepo(
  repoRoot: string,
  args: string[],
  options?: {
    input?: string
    maxBuffer?: number
    preserveOutputOnError?: boolean
  },
) {
  return execFileNoThrowWithCwd(gitExe(), args, {
    cwd: repoRoot,
    input: options?.input,
    maxBuffer: options?.maxBuffer,
    preserveOutputOnError: options?.preserveOutputOnError ?? true,
  })
}

export function getGitRootForPath(filePath?: string): string | null {
  return findGitRoot(filePath ? dirname(resolve(filePath)) : getCwd())
}

export async function getGitContextSnapshot(
  repoRoot = getGitRootForPath(),
): Promise<GitContextSnapshot | null> {
  if (!repoRoot) {
    return null
  }

  const [branchResult, statusResult, commitsResult] = await Promise.all([
    runGitInRepo(repoRoot, ['branch', '--show-current'], {
      preserveOutputOnError: false,
    }),
    runGitInRepo(repoRoot, ['--no-optional-locks', 'status', '--short'], {
      preserveOutputOnError: false,
    }),
    runGitInRepo(
      repoRoot,
      [
        '--no-optional-locks',
        'log',
        '--oneline',
        '-n',
        String(DEFAULT_RECENT_COMMIT_COUNT),
      ],
      {
        preserveOutputOnError: false,
      },
    ),
  ])

  if (branchResult.code !== 0) {
    return null
  }

  return {
    branch: branchResult.stdout.trim() || '(detached HEAD)',
    status: truncateText(
      statusResult.stdout.trim() || '(clean)',
      MAX_GIT_CONTEXT_STATUS_CHARS,
    ),
    recentCommits: commitsResult.stdout.trim() || '(none)',
  }
}

export async function getGitPromptContext(): Promise<string | null> {
  const snapshot = await getGitContextSnapshot()
  if (!snapshot) {
    return null
  }

  return [
    'This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.',
    `Current branch: ${snapshot.branch}`,
    `Uncommitted changes:\n${snapshot.status}`,
    `Recent commits:\n${snapshot.recentCommits}`,
  ].join('\n\n')
}

function classifyCommitType(paths: string[]): 'docs' | 'test' | 'chore' {
  if (
    paths.every(
      file =>
        file.startsWith('docs/') ||
        file.endsWith('.md') ||
        file.endsWith('.mdx'),
    )
  ) {
    return 'docs'
  }
  if (
    paths.every(
      file =>
        file.includes('.test.') ||
        file.includes('.spec.') ||
        file.includes('__tests__/') ||
        file.startsWith('test/'),
    )
  ) {
    return 'test'
  }
  return 'chore'
}

function inferCommitAction(statuses: string[]): 'add' | 'remove' | 'update' {
  if (
    statuses.length > 0 &&
    statuses.every(status => status === 'A' || status === '??')
  ) {
    return 'add'
  }
  if (statuses.length > 0 && statuses.every(status => status === 'D')) {
    return 'remove'
  }
  return 'update'
}

function describeCommitTarget(paths: string[]): string {
  if (paths.length === 1) {
    return paths[0]!
  }

  const topLevelDirs = new Set(paths.map(file => file.split('/')[0] || file))
  if (topLevelDirs.size === 1) {
    return [...topLevelDirs][0]!
  }

  return `${paths.length} files`
}

async function getStatusesForPaths(
  repoRoot: string,
  repoPaths: string[],
): Promise<string[]> {
  const result = await runGitInRepo(
    repoRoot,
    ['--no-optional-locks', 'status', '--porcelain', '--', ...repoPaths],
    { preserveOutputOnError: false },
  )
  if (result.code !== 0) {
    return []
  }
  return result.stdout
    .split('\n')
    .map(line => line.slice(0, 2).trim())
    .filter(Boolean)
}

async function buildAutoCommitMessage(
  repoRoot: string,
  repoPaths: string[],
): Promise<string> {
  const statuses = await getStatusesForPaths(repoRoot, repoPaths)
  const type = classifyCommitType(repoPaths)
  const action = inferCommitAction(statuses)
  const target = describeCommitTarget(repoPaths)
  return `${type}: ${action} ${target}`
}

export async function autoCommitFiles(
  filePaths: string[],
): Promise<AutoCommitResult> {
  if (filePaths.length === 0) {
    return {
      committed: false,
      reason: 'No files were provided for auto-commit.',
    }
  }

  const repoRoots = new Set(
    filePaths
      .map(filePath => getGitRootForPath(filePath))
      .filter((value): value is string => value !== null),
  )

  if (repoRoots.size !== 1) {
    return {
      committed: false,
      reason: 'Auto-commit requires all files to belong to the same git repository.',
    }
  }

  const repoRoot = [...repoRoots][0]!
  const repoPaths = [
    ...new Set(
      filePaths
        .map(filePath => normalizeRepoPath(repoRoot, filePath))
        .filter((value): value is string => value !== null),
    ),
  ]

  if (repoPaths.length === 0) {
    return {
      committed: false,
      reason: 'Changed file is outside the current repository root.',
    }
  }

  const statusResult = await runGitInRepo(
    repoRoot,
    ['--no-optional-locks', 'status', '--porcelain', '--', ...repoPaths],
    { preserveOutputOnError: false },
  )
  if (statusResult.code !== 0 || statusResult.stdout.trim().length === 0) {
    return {
      committed: false,
      reason: 'No git changes were detected for the edited file.',
    }
  }

  const message = await buildAutoCommitMessage(repoRoot, repoPaths)

  const addResult = await runGitInRepo(repoRoot, ['add', '--', ...repoPaths])
  if (addResult.code !== 0) {
    return {
      committed: false,
      reason: addResult.stderr.trim() || addResult.stdout.trim() || 'git add failed',
      output: [addResult.stdout, addResult.stderr].filter(Boolean).join('\n'),
    }
  }

  const diffResult = await runGitInRepo(
    repoRoot,
    ['diff', '--cached', '--quiet', '--', ...repoPaths],
    { preserveOutputOnError: false },
  )
  if (diffResult.code === 0) {
    return {
      committed: false,
      reason: 'Staged diff is empty after git add.',
    }
  }

  const commitResult = await runGitInRepo(repoRoot, [
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--no-verify',
    '-m',
    message,
    '--',
    ...repoPaths,
  ])

  if (commitResult.code !== 0) {
    return {
      committed: false,
      reason:
        commitResult.stderr.trim() ||
        commitResult.stdout.trim() ||
        'git commit failed',
      output: [commitResult.stdout, commitResult.stderr].filter(Boolean).join('\n'),
    }
  }

  trackGitOperations('git commit', 0, commitResult.stdout)

  const sha =
    parseGitCommitId(commitResult.stdout) ||
    (
      await runGitInRepo(
        repoRoot,
        ['rev-parse', '--short', 'HEAD'],
        { preserveOutputOnError: false },
      )
    ).stdout.trim() ||
    undefined

  return {
    committed: true,
    sha,
    message,
    output: [commitResult.stdout, commitResult.stderr].filter(Boolean).join('\n'),
  }
}

export async function diffSinceLastCommit(
  repoRoot = getGitRootForPath(),
): Promise<GitCommandOutput> {
  if (!repoRoot) {
    return {
      success: false,
      output: 'Not inside a git repository.',
    }
  }

  const [statusResult, summaryResult, diffResult] = await Promise.all([
    runGitInRepo(repoRoot, ['--no-optional-locks', 'status', '--short'], {
      preserveOutputOnError: false,
    }),
    runGitInRepo(repoRoot, ['--no-optional-locks', 'diff', '--stat', 'HEAD'], {
      preserveOutputOnError: false,
    }),
    runGitInRepo(
      repoRoot,
      ['--no-optional-locks', 'diff', '--unified=3', 'HEAD'],
      { maxBuffer: 2_000_000, preserveOutputOnError: false },
    ),
  ])

  const sections = [
    `Repository: ${repoRoot}`,
    `Uncommitted changes:\n${statusResult.stdout.trim() || '(clean)'}`,
    `Diff summary:\n${summaryResult.stdout.trim() || '(no diff)'}`,
    `Patch:\n${truncateText(diffResult.stdout.trim() || '(no patch output)', DEFAULT_DIFF_CHARS)}`,
  ]

  return {
    success: true,
    output: sections.join('\n\n'),
  }
}

export async function undoRecentCommits(
  count: number,
  repoRoot = getGitRootForPath(),
): Promise<GitCommandOutput> {
  const validatedCount = Number.isInteger(count)
    ? Math.min(Math.max(count, 1), 50)
    : 1

  if (!repoRoot) {
    return {
      success: false,
      output: 'Not inside a git repository.',
    }
  }

  const commitsResult = await runGitInRepo(
    repoRoot,
    ['--no-optional-locks', 'log', '--oneline', '-n', String(validatedCount)],
    { preserveOutputOnError: false },
  )
  const commits = commitsResult.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  if (commits.length < validatedCount) {
    return {
      success: false,
      output: `Cannot undo ${validatedCount} commit(s): repository only has ${commits.length} visible commit(s).`,
    }
  }

  const resetResult = await runGitInRepo(repoRoot, [
    'reset',
    '--soft',
    `HEAD~${validatedCount}`,
  ])

  if (resetResult.code !== 0) {
    return {
      success: false,
      output:
        resetResult.stderr.trim() ||
        resetResult.stdout.trim() ||
        'git reset --soft failed',
    }
  }

  const statusResult = await runGitInRepo(
    repoRoot,
    ['--no-optional-locks', 'status', '--short'],
    { preserveOutputOnError: false },
  )

  return {
    success: true,
    output: [
      `Undid ${validatedCount} commit(s):`,
      commits.map(commit => `- ${commit}`).join('\n'),
      `Current status:\n${statusResult.stdout.trim() || '(clean)'}`,
    ].join('\n\n'),
  }
}

async function extractKeyExports(filePath: string): Promise<string[]> {
  if (!EXPORTABLE_EXTENSIONS.has(extname(filePath))) {
    return []
  }

  const fileStat = await stat(filePath)
  if (fileStat.size > MAX_EXPORT_BYTES) {
    return []
  }

  const content = await readFile(filePath, 'utf8')
  const exportNames = new Set<string>()
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
    /export\s+(?:const|let|var|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g,
    /export\s+default\s+(?:async\s+)?(?:function|class)?\s*([A-Za-z0-9_$]+)?/g,
    /export\s*{\s*([^}]+)\s*}/g,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      if (pattern === patterns[3]) {
        const raw = match[1] || ''
        const namedExports = raw
          .split(',')
          .map(part => part.trim().split(/\s+as\s+/i)[1] || part.trim().split(/\s+as\s+/i)[0] || '')
          .map(part => part.trim())
          .filter(Boolean)
        for (const name of namedExports) {
          exportNames.add(name)
        }
        continue
      }

      const name = match[1]?.trim()
      exportNames.add(name || 'default')
    }
  }

  return [...exportNames].slice(0, 4)
}

async function buildRepoTreeLines(
  currentPath: string,
  depth: number,
  maxDepth: number,
  lines: string[],
  limit: number,
): Promise<void> {
  if (depth > maxDepth || lines.length >= limit) {
    return
  }

  const entries = await readdir(currentPath, { withFileTypes: true })
  entries.sort((left, right) => {
    if (left.isDirectory() && !right.isDirectory()) return -1
    if (!left.isDirectory() && right.isDirectory()) return 1
    return left.name.localeCompare(right.name)
  })

  for (const entry of entries) {
    if (lines.length >= limit) {
      return
    }

    if (entry.isDirectory() && REPO_MAP_IGNORED_DIRS.has(entry.name)) {
      continue
    }

    const fullPath = join(currentPath, entry.name)
    const indent = '  '.repeat(depth)

    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`)
      await buildRepoTreeLines(
        fullPath,
        depth + 1,
        maxDepth,
        lines,
        limit,
      )
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const fileStat = await stat(fullPath)
    const keyExports = await extractKeyExports(fullPath)
    const exportSuffix =
      keyExports.length > 0 ? ` exports: ${keyExports.join(', ')}` : ''
    lines.push(
      `${indent}${entry.name} (${formatBytes(fileStat.size)})${exportSuffix}`,
    )
  }
}

export async function generateRepoMap(options?: {
  maxDepth?: number
  maxEntries?: number
  repoRoot?: string
}): Promise<GitCommandOutput> {
  const repoRoot = options?.repoRoot ?? getGitRootForPath() ?? getCwd()
  const maxDepth = Math.min(
    Math.max(options?.maxDepth ?? DEFAULT_REPO_MAP_DEPTH, 1),
    8,
  )
  const maxEntries = Math.min(
    Math.max(options?.maxEntries ?? DEFAULT_REPO_MAP_ENTRIES, 25),
    1_000,
  )
  const lines = [`${basename(repoRoot) || repoRoot}/`]

  try {
    await buildRepoTreeLines(repoRoot, 1, maxDepth, lines, maxEntries)
  } catch (error) {
    return {
      success: false,
      output: `Failed to generate repo map: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (lines.length >= maxEntries) {
    lines.push('... (repo map truncated)')
  }

  return {
    success: true,
    output: lines.join('\n'),
  }
}
