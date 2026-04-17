import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  hasSafeReadOnlyPathGlobs,
  resolveReadOnlyCdTarget,
} from './readOnlyValidation.helpers.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    rmSync(dir, { recursive: true, force: true })
  }
})

function createFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fc-readonly-glob-'))
  tempDirs.push(dir)
  return dir
}

describe('readOnlyValidation helpers', () => {
  test('allows read-only path globs when matches cannot be reinterpreted as flags', () => {
    const dir = createFixtureDir()
    writeFileSync(join(dir, 'alpha.ts'), 'export {}')
    writeFileSync(join(dir, 'beta.ts'), 'export {}')

    expect(hasSafeReadOnlyPathGlobs('ls *.ts', dir)).toBe(true)
    expect(hasSafeReadOnlyPathGlobs('cat *.ts', dir)).toBe(true)
  })

  test('rejects read-only path globs when a match starts with a dash', () => {
    const dir = createFixtureDir()
    writeFileSync(join(dir, '--danger.ts'), 'export {}')

    expect(hasSafeReadOnlyPathGlobs('ls *.ts', dir)).toBe(false)
  })

  test('allows dashed glob matches after explicit double-dash', () => {
    const dir = createFixtureDir()
    writeFileSync(join(dir, '--danger.ts'), 'export {}')

    expect(hasSafeReadOnlyPathGlobs('ls -- *.ts', dir)).toBe(true)
    expect(hasSafeReadOnlyPathGlobs('cat -- *.ts', dir)).toBe(true)
  })

  test('does not treat glob-like flag arguments as safe path globs', () => {
    const dir = createFixtureDir()
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'alpha.ts'), 'export {}')

    expect(hasSafeReadOnlyPathGlobs('rg --glob *.ts foo src', dir)).toBe(false)
  })

  test('resolves cd targets for compound read-only commands', () => {
    const dir = createFixtureDir()
    const nested = join(dir, 'nested')
    mkdirSync(nested)
    writeFileSync(join(nested, 'nested.ts'), 'export {}')

    expect(resolveReadOnlyCdTarget('cd nested', dir)).toBe(nested)
    expect(resolveReadOnlyCdTarget('cd', dir)).toBeTruthy()
    expect(hasSafeReadOnlyPathGlobs('ls *.ts', nested)).toBe(true)
  })
})
