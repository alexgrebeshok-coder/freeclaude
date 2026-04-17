import { homedir } from 'node:os'
import { basename, isAbsolute, resolve } from 'node:path'
import { readdirSync } from 'node:fs'
import picomatch from 'picomatch'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'

const GLOB_PATTERN_REGEX = /[*?[\]]/
const MAX_GLOB_TRAVERSAL_ENTRIES = 2000

type ParsedArg = {
  value: string
  isUnquotedGlob: boolean
}

type IndexedArgument = {
  index: number
  afterDoubleDash: boolean
}

function parseCommand(command: string): ParsedArg[] | null {
  const parseResult = tryParseShellCommand(command, env => `$${env}`)
  if (!parseResult.success) {
    return null
  }

  const parsedArgs: ParsedArg[] = []
  for (const token of parseResult.tokens) {
    if (typeof token === 'string') {
      parsedArgs.push({ value: token, isUnquotedGlob: false })
      continue
    }
    if (
      typeof token === 'object' &&
      token !== null &&
      'op' in token &&
      token.op === 'glob' &&
      'pattern' in token
    ) {
      parsedArgs.push({
        value: String(token.pattern),
        isUnquotedGlob: true,
      })
      continue
    }
    return null
  }

  return parsedArgs
}

function filterOutFlagsWithIndexes(args: ParsedArg[]): IndexedArgument[] {
  const result: IndexedArgument[] = []
  let afterDoubleDash = false

  for (const [index, arg] of args.entries()) {
    if (afterDoubleDash) {
      result.push({ index, afterDoubleDash: true })
      continue
    }
    if (arg.value === '--') {
      afterDoubleDash = true
      continue
    }
    if (!arg.value.startsWith('-')) {
      result.push({ index, afterDoubleDash: false })
    }
  }

  return result
}

function parsePatternCommandWithIndexes(
  args: ParsedArg[],
  flagsWithArgs: Set<string>,
  defaults: IndexedArgument[] = [],
): IndexedArgument[] {
  const paths: IndexedArgument[] = []
  let patternFound = false
  let afterDoubleDash = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue

    if (!afterDoubleDash && arg.value === '--') {
      afterDoubleDash = true
      continue
    }

    if (!afterDoubleDash && arg.value.startsWith('-')) {
      const flag = arg.value.split('=')[0]
      if (flag && ['-e', '--regexp', '-f', '--file'].includes(flag)) {
        patternFound = true
      }
      if (flag && flagsWithArgs.has(flag) && !arg.value.includes('=')) {
        i++
      }
      continue
    }

    if (!patternFound) {
      patternFound = true
      continue
    }

    paths.push({ index: i, afterDoubleDash })
  }

  return paths.length > 0 ? paths : defaults
}

function extractReadOnlyPathArgumentIndexes(
  baseCommand: string,
  args: ParsedArg[],
): IndexedArgument[] {
  switch (baseCommand) {
    case 'cd':
      return args.length === 0 ? [] : [{ index: 0, afterDoubleDash: false }]
    case 'ls':
    case 'cat':
    case 'head':
    case 'tail':
    case 'sort':
    case 'uniq':
    case 'wc':
    case 'cut':
    case 'paste':
    case 'column':
    case 'file':
    case 'stat':
    case 'diff':
    case 'awk':
    case 'strings':
    case 'hexdump':
    case 'od':
    case 'base64':
    case 'nl':
    case 'sha256sum':
    case 'sha1sum':
    case 'md5sum':
    case 'tree':
      return filterOutFlagsWithIndexes(args)
    case 'grep': {
      return parsePatternCommandWithIndexes(
        args,
        new Set([
          '-e',
          '--regexp',
          '-f',
          '--file',
          '--exclude',
          '--include',
          '--exclude-dir',
          '--include-dir',
          '-m',
          '--max-count',
          '-A',
          '--after-context',
          '-B',
          '--before-context',
          '-C',
          '--context',
        ]),
      )
    }
    case 'rg': {
      return parsePatternCommandWithIndexes(
        args,
        new Set([
          '-e',
          '--regexp',
          '-f',
          '--file',
          '-t',
          '--type',
          '-T',
          '--type-not',
          '-g',
          '--glob',
          '-m',
          '--max-count',
          '--max-depth',
          '-r',
          '--replace',
          '-A',
          '--after-context',
          '-B',
          '--before-context',
          '-C',
          '--context',
        ]),
        [{ index: args.length, afterDoubleDash: false }],
      ).filter(arg => arg.index < args.length)
    }
    case 'jq': {
      const paths: IndexedArgument[] = []
      const flagsWithArgs = new Set([
        '-e',
        '--expression',
        '-f',
        '--from-file',
        '--arg',
        '--argjson',
        '--slurpfile',
        '--rawfile',
        '--args',
        '--jsonargs',
        '-L',
        '--library-path',
        '--indent',
        '--tab',
      ])
      let filterFound = false
      let afterDoubleDash = false

      for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (!arg) continue

        if (!afterDoubleDash && arg.value === '--') {
          afterDoubleDash = true
          continue
        }

        if (!afterDoubleDash && arg.value.startsWith('-')) {
          const flag = arg.value.split('=')[0]
          if (flag && ['-e', '--expression'].includes(flag)) {
            filterFound = true
          }
          if (flag && flagsWithArgs.has(flag) && !arg.value.includes('=')) {
            i++
          }
          continue
        }

        if (!filterFound) {
          filterFound = true
          continue
        }

        paths.push({ index: i, afterDoubleDash })
      }

      return paths
    }
    default:
      return []
  }
}

function getGlobBaseDirectory(pattern: string): string {
  const globMatch = pattern.match(GLOB_PATTERN_REGEX)
  if (!globMatch || globMatch.index === undefined) {
    return pattern
  }

  const beforeGlob = pattern.substring(0, globMatch.index)
  const lastSepIndex = Math.max(beforeGlob.lastIndexOf('/'), beforeGlob.lastIndexOf('\\'))
  if (lastSepIndex === -1) {
    return '.'
  }

  return beforeGlob.substring(0, lastSepIndex) || '/'
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll('\\', '/')
}

function collectGlobMatches(
  absolutePattern: string,
  baseDirectory: string,
): string[] | null {
  const matcher = picomatch(absolutePattern, { dot: true })
  const baseEntries = [baseDirectory]
  const matches: string[] = []
  let seenEntries = 0

  while (baseEntries.length > 0) {
    const currentDirectory = baseEntries.pop()
    if (!currentDirectory) {
      continue
    }

    let entries
    try {
      entries = readdirSync(currentDirectory, { withFileTypes: true })
    } catch {
      return null
    }

    for (const entry of entries) {
      seenEntries++
      if (seenEntries > MAX_GLOB_TRAVERSAL_ENTRIES) {
        return null
      }

      const absoluteEntryPath = normalizePath(
        resolve(currentDirectory, entry.name),
      )

      if (matcher(absoluteEntryPath)) {
        matches.push(absoluteEntryPath)
      }

      if (entry.isDirectory()) {
        baseEntries.push(resolve(currentDirectory, entry.name))
      }
    }
  }

  return matches
}

function expandReadOnlyGlobMatches(pattern: string, cwd: string): string[] | null {
  const normalizedPattern = normalizePath(
    isAbsolute(pattern) ? pattern : resolve(cwd, pattern),
  )
  const baseDirectory = resolve(cwd, getGlobBaseDirectory(pattern))
  return collectGlobMatches(normalizedPattern, baseDirectory)
}

export function hasSafeReadOnlyPathGlobs(command: string, cwd: string): boolean {
  const parsed = parseCommand(command)
  if (!parsed || parsed.length === 0) {
    return false
  }

  const [baseCommand, ...args] = parsed
  if (!baseCommand) {
    return false
  }

  const pathArgs = extractReadOnlyPathArgumentIndexes(baseCommand.value, args)
  if (pathArgs.length === 0) {
    return false
  }

  const pathArgIndexes = new Map(pathArgs.map(arg => [arg.index, arg.afterDoubleDash]))
  const globArgs = args
    .map((arg, index) => ({ ...arg, index }))
    .filter(arg => arg.isUnquotedGlob)

  if (globArgs.length === 0) {
    return false
  }

  for (const globArg of globArgs) {
    const protectedByDoubleDash = pathArgIndexes.get(globArg.index)
    if (protectedByDoubleDash === undefined) {
      return false
    }
    if (protectedByDoubleDash) {
      continue
    }

    const matches = expandReadOnlyGlobMatches(globArg.value, cwd)
    if (matches === null) {
      return false
    }
    if (matches.some(match => basename(match).startsWith('-'))) {
      return false
    }
  }

  return true
}

export function resolveReadOnlyCdTarget(command: string, cwd: string): string | null {
  const parsed = parseCommand(command)
  if (!parsed || parsed.length === 0 || parsed[0]?.value !== 'cd') {
    return null
  }

  const args = parsed.slice(1).map(arg => arg.value)
  if (args.length === 0) {
    return homedir()
  }

  const cdTarget = args.join(' ')
  if (
    cdTarget === '~' ||
    cdTarget.startsWith('~/') ||
    cdTarget.startsWith('~\\')
  ) {
    return resolve(homedir(), cdTarget.slice(2))
  }

  return isAbsolute(cdTarget) ? resolve(cdTarget) : resolve(cwd, cdTarget)
}
