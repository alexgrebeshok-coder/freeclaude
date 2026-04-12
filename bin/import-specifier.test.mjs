import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { getDistImportSpecifier } from './import-specifier.mjs'

test('builds a file URL import specifier for dist/cli.mjs', () => {
  const baseDir = join(process.cwd(), 'bin')
  const specifier = getDistImportSpecifier(baseDir)
  const expected = pathToFileURL(join(process.cwd(), 'dist', 'cli.mjs')).href

  assert.equal(
    specifier,
    expected,
  )
})
