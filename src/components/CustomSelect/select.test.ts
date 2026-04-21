// chalk reads FORCE_COLOR when first imported, so we must set it before any
// transitive chalk import runs. Without this, chalk.level is 0 in the test
// runner (stdout is not a TTY) and <Text bold color="suggestion"> emits plain
// text, leaving styleId === 0 on every cell and breaking the focus-row check.
process.env.FORCE_COLOR = process.env.FORCE_COLOR ?? '1'

import { describe, expect, test } from 'bun:test'
import React, { createElement } from 'react'
import { PassThrough } from 'stream'
import chalk from 'chalk'
import { renderSync } from '../../ink/root.js'
import instances from '../../ink/instances.js'
import { cellAt, type Screen } from '../../ink/screen.js'
import { Select } from './select.js'

if (chalk.level === 0) {
  // Belt-and-braces: if chalk was already imported elsewhere and cached a
  // level of 0, override it so style runs emit SGR codes.
  chalk.level = 1
}

type TestStdout = PassThrough & {
  isTTY: boolean
  columns: number
  rows: number
}

type TestStdin = PassThrough & {
  isTTY: boolean
  setRawMode: (enabled: boolean) => TestStdin
  ref: () => TestStdin
  unref: () => TestStdin
  setEncoding: (encoding: string) => TestStdin
}

function createTestStdout(): TestStdout {
  const stdout = new PassThrough() as TestStdout
  stdout.isTTY = true
  stdout.columns = 20
  stdout.rows = 6
  return stdout
}

/**
 * Ink's App.handleSetRawMode throws if the provided stdin is not a TTY
 * — Bun's test runner does not expose process.stdin as a TTY, so tests
 * must supply a fake stdin that claims TTY support and implements the
 * lifecycle methods Ink expects (setRawMode, ref/unref, setEncoding).
 */
function createTestStdin(): TestStdin {
  const stdin = new PassThrough() as TestStdin
  stdin.isTTY = true
  stdin.setRawMode = () => stdin
  stdin.ref = () => stdin
  stdin.unref = () => stdin
  stdin.setEncoding = () => stdin
  return stdin
}

async function flushInk(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 10))
}

function getScreen(stdout: TestStdout): Screen {
  const ink = instances.get(stdout)
  expect(ink).toBeDefined()

  const frontFrame = Reflect.get(ink!, 'frontFrame')
  if (
    frontFrame === null ||
    typeof frontFrame !== 'object' ||
    !('screen' in frontFrame)
  ) {
    throw new Error('Ink frontFrame is unavailable')
  }

  return frontFrame.screen as Screen
}

function getRowText(screen: Screen, row: number): string {
  let text = ''
  for (let column = 0; column < screen.width; column++) {
    text += cellAt(screen, column, row)?.char ?? ' '
  }

  return text
}

function rowHasStyledCells(screen: Screen, row: number): boolean {
  for (let column = 0; column < screen.width; column++) {
    if ((cellAt(screen, column, row)?.styleId ?? 0) !== 0) {
      return true
    }
  }

  return false
}

describe('Select', () => {
  test('moves the styled focus row when focus changes', async () => {
    const stdout = createTestStdout()
    const stdin = createTestStdin()
    const options = [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ]
    const instance = renderSync(
      createElement(Select, {
        options,
        defaultFocusValue: 'yes',
        hideIndexes: true,
      }),
      {
        stdout,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: process.stderr,
        patchConsole: false,
        exitOnCtrlC: false,
      },
    )

    try {
      await flushInk()

      let screen = getScreen(stdout)
      expect(getRowText(screen, 0)).toContain('❯ Yes')
      expect(rowHasStyledCells(screen, 0)).toBe(true)
      expect(rowHasStyledCells(screen, 1)).toBe(false)

      instance.rerender(
        createElement(Select, {
          options,
          defaultFocusValue: 'no',
          hideIndexes: true,
        }),
      )

      await flushInk()

      screen = getScreen(stdout)
      expect(getRowText(screen, 1)).toContain('❯ No')
      expect(rowHasStyledCells(screen, 0)).toBe(false)
      expect(rowHasStyledCells(screen, 1)).toBe(true)
    } finally {
      instance.unmount()
      instance.cleanup()
    }
  })
})
