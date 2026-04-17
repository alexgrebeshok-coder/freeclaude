import { describe, expect, test } from 'bun:test'
import {
  findAvailableTask,
  formatTaskAsPrompt,
} from './useTaskListWatcher.helpers.js'

describe('useTaskListWatcher helpers', () => {
  test('finds the first pending unowned task whose blockers are resolved', () => {
    const task = findAvailableTask([
      {
        id: '1',
        subject: 'Blocked task',
        description: '',
        status: 'pending',
        blocks: [],
        blockedBy: ['2'],
      },
      {
        id: '2',
        subject: 'Dependency',
        description: '',
        status: 'completed',
        blocks: ['1'],
        blockedBy: [],
      },
      {
        id: '3',
        subject: 'Ready task',
        description: '',
        status: 'pending',
        blocks: [],
        blockedBy: [],
      },
    ])

    expect(task?.id).toBe('1')
  })

  test('skips owned or blocked tasks and formats prompts with description', () => {
    const task = findAvailableTask([
      {
        id: '1',
        subject: 'Owned task',
        description: '',
        owner: 'agent-a',
        status: 'pending',
        blocks: [],
        blockedBy: [],
      },
      {
        id: '2',
        subject: 'Blocked task',
        description: '',
        status: 'pending',
        blocks: [],
        blockedBy: ['3'],
      },
      {
        id: '3',
        subject: 'Dependency',
        description: '',
        status: 'in_progress',
        blocks: ['2'],
        blockedBy: [],
      },
    ])

    expect(task).toBeUndefined()
    expect(
      formatTaskAsPrompt({
        id: '7',
        subject: 'Investigate failure',
        description: 'Read logs and fix the root cause',
      }),
    ).toContain('Read logs and fix the root cause')
  })
})
