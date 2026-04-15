import { describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseOptions,
  replaceCliDisplayVersion,
  replaceReadmeVersionBadge,
  replaceVoicePipelineVersionAssertions,
  syncVersion,
} from './sync-version.ts'

describe('sync-version', () => {
  test('parseOptions requires a semver-like version', () => {
    expect(parseOptions(['4.2.1-beta.1+build.7'])).toEqual({
      version: '4.2.1-beta.1+build.7',
    })
    expect(() => parseOptions([])).toThrow(
      'Usage: bun run scripts/sync-version.ts <version>',
    )
    expect(() => parseOptions(['latest'])).toThrow('Invalid version: latest')
  })

  test('surface helpers update the targeted version strings', () => {
    expect(
      replaceReadmeVersionBadge(
        '[![v3.1.0](https://img.shields.io/badge/version-3.1.0-brightgreen)](https://example.com/releases)',
        '4.0.0',
      ),
    ).toContain('v4.0.0')

    expect(
      replaceCliDisplayVersion("console.log('3.1.0 (FreeClaude)')", '4.0.0'),
    ).toContain('4.0.0 (FreeClaude)')

    const voiceTest = [
      "test('cli.mjs contains 3.1.0', () => {",
      "  expect(cli).toContain('3.1.0')",
      '})',
    ].join('\n')
    expect(replaceVoicePipelineVersionAssertions(voiceTest, '4.0.0')).toContain(
      "test('cli.mjs contains 4.0.0'",
    )
  })

  test('syncVersion updates all tracked release surfaces', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'freeclaude-version-sync-'))

    try {
      mkdirSync(join(repoRoot, 'desktop', 'src-tauri'), { recursive: true })
      mkdirSync(join(repoRoot, 'extension'), { recursive: true })
      mkdirSync(join(repoRoot, 'dist'), { recursive: true })
      mkdirSync(join(repoRoot, 'src', 'services', 'voice'), { recursive: true })

      writeFileSync(
        join(repoRoot, 'package.json'),
        JSON.stringify({ name: '@freeclaude/cli', version: '3.1.0' }, null, 2) + '\n',
      )
      writeFileSync(
        join(repoRoot, 'desktop', 'package.json'),
        JSON.stringify({ name: 'desktop', version: '3.1.0' }, null, 2) + '\n',
      )
      writeFileSync(
        join(repoRoot, 'desktop', 'src-tauri', 'tauri.conf.json'),
        JSON.stringify({ productName: 'FreeClaude', version: '3.1.0' }, null, 2) + '\n',
      )
      writeFileSync(
        join(repoRoot, 'extension', 'package.json'),
        JSON.stringify({ name: 'freeclaude', version: '3.1.0' }, null, 2) + '\n',
      )
      writeFileSync(
        join(repoRoot, 'README.md'),
        '[![v3.1.0](https://img.shields.io/badge/version-3.1.0-brightgreen)](https://github.com/example/freeclaude/releases)\n',
      )
      writeFileSync(
        join(repoRoot, 'dist', 'cli.mjs'),
        "console.log('3.1.0 (FreeClaude)')\n",
      )
      writeFileSync(
        join(repoRoot, 'src', 'services', 'voice', 'voice-pipeline.test.ts'),
        [
          "test('cli.mjs contains 3.1.0', () => {",
          "  expect(cli).toContain('3.1.0')",
          '})',
        ].join('\n'),
      )

      const results = syncVersion(repoRoot, '4.0.0')

      expect(results).toEqual([
        { path: 'package.json', status: 'updated' },
        { path: join('desktop', 'package.json'), status: 'updated' },
        { path: join('desktop', 'src-tauri', 'tauri.conf.json'), status: 'updated' },
        { path: join('extension', 'package.json'), status: 'updated' },
        { path: 'README.md', status: 'updated' },
        { path: join('dist', 'cli.mjs'), status: 'updated' },
        {
          path: join('src', 'services', 'voice', 'voice-pipeline.test.ts'),
          status: 'updated',
        },
      ])

      expect(readFileSync(join(repoRoot, 'package.json'), 'utf8')).toContain(
        '"version": "4.0.0"',
      )
      expect(readFileSync(join(repoRoot, 'README.md'), 'utf8')).toContain(
        '[![v4.0.0](https://img.shields.io/badge/version-4.0.0-brightgreen)]',
      )
      expect(readFileSync(join(repoRoot, 'dist', 'cli.mjs'), 'utf8')).toContain(
        '4.0.0 (FreeClaude)',
      )
      expect(
        readFileSync(
          join(repoRoot, 'src', 'services', 'voice', 'voice-pipeline.test.ts'),
          'utf8',
        ),
      ).toContain("expect(cli).toContain('4.0.0')")
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
