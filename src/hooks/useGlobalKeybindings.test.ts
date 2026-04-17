import { describe, expect, test } from 'bun:test'
import { getNextExpandedView } from './useGlobalKeybindings.helpers.js'

describe('useGlobalKeybindings helpers', () => {
  test('cycles expanded view through tasks and teammates when teammates exist', () => {
    expect(getNextExpandedView('none', true)).toBe('tasks')
    expect(getNextExpandedView('tasks', true)).toBe('teammates')
    expect(getNextExpandedView('teammates', true)).toBe('none')
  })

  test('toggles only between none and tasks when no teammates exist', () => {
    expect(getNextExpandedView('none', false)).toBe('tasks')
    expect(getNextExpandedView('tasks', false)).toBe('none')
    expect(getNextExpandedView('teammates', false)).toBe('tasks')
  })
})
