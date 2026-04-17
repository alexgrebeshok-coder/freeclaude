import { describe, expect, test } from 'bun:test'
import { getNextTeammateSelectionState } from './useBackgroundTaskNavigation.helpers.js'

describe('useBackgroundTaskNavigation helpers', () => {
  test('expands teammate view on first navigation step', () => {
    expect(
      getNextTeammateSelectionState(
        {
          expandedView: 'none',
          viewSelectionMode: 'none',
          selectedIPAgentIndex: 4,
        },
        3,
        1,
      ),
    ).toEqual({
      expandedView: 'teammates',
      viewSelectionMode: 'selecting-agent',
      selectedIPAgentIndex: -1,
    })
  })

  test('wraps selection across leader, teammates and hide row', () => {
    expect(
      getNextTeammateSelectionState(
        {
          expandedView: 'teammates',
          viewSelectionMode: 'selecting-agent',
          selectedIPAgentIndex: 3,
        },
        3,
        1,
      ).selectedIPAgentIndex,
    ).toBe(-1)

    expect(
      getNextTeammateSelectionState(
        {
          expandedView: 'teammates',
          viewSelectionMode: 'selecting-agent',
          selectedIPAgentIndex: -1,
        },
        3,
        -1,
      ).selectedIPAgentIndex,
    ).toBe(3)
  })
})
