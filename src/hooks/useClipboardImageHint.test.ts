import { describe, expect, test } from 'bun:test'
import {
  isClipboardHintOnCooldown,
  shouldCheckClipboardImageHint,
} from './useClipboardImageHint.helpers.js'

describe('useClipboardImageHint helpers', () => {
  test('only checks clipboard on focus regain when enabled', () => {
    expect(
      shouldCheckClipboardImageHint({
        enabled: true,
        isFocused: true,
        wasFocused: false,
      }),
    ).toBe(true)

    expect(
      shouldCheckClipboardImageHint({
        enabled: false,
        isFocused: true,
        wasFocused: false,
      }),
    ).toBe(false)

    expect(
      shouldCheckClipboardImageHint({
        enabled: true,
        isFocused: true,
        wasFocused: true,
      }),
    ).toBe(false)
  })

  test('honors cooldown window for repeated hints', () => {
    expect(isClipboardHintOnCooldown(1000, 2000, 1500)).toBe(true)
    expect(isClipboardHintOnCooldown(1000, 4000, 1500)).toBe(false)
  })
})
