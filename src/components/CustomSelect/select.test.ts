import { describe, expect, test } from 'bun:test'
import React, { createElement } from 'react'
import { PassThrough } from 'stream'
import { renderSync } from '../../ink/root.js'
import instances from '../../ink/instances.js'
import { cellAt, type Screen } from '../../ink/screen.js'
import { Select } from './select.js'

type TestStdout = PassThrough & {
  isTTY: boolean
  columns: number
  rows: number
}

function createTestStdout(): TestStdout {
  const stdout = new PassThrough() as TestStdout
  stdout.isTTY = true
  stdout.columns = 20
  stdout.rows = 6
  return stdout
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
        stdin: process.stdin,
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
