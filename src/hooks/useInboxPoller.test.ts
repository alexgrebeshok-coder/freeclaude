import { describe, expect, test } from 'bun:test'
import {
  buildQueuedInboxMessages,
  formatInboxMessages,
} from './useInboxPoller.helpers.js'

describe('useInboxPoller helpers', () => {
  test('formats inbox messages with optional metadata', () => {
    const formatted = formatInboxMessages([
      {
        from: 'alice',
        text: 'Need review on the parser',
        color: 'green',
        summary: 'Parser review requested',
      },
      {
        from: 'bob',
        text: 'Done',
      },
    ])

    expect(formatted).toContain('<teammate-message teammate_id="alice" color="green" summary="Parser review requested">')
    expect(formatted).toContain('Need review on the parser')
    expect(formatted).toContain('<teammate-message teammate_id="bob">')
    expect(formatted).toContain('\n\n<teammate-message teammate_id="bob">')
  })

  test('builds queued inbox messages with pending status and preserved metadata', () => {
    const queued = buildQueuedInboxMessages(
      [
        {
          from: 'alice',
          text: 'Queued message',
          timestamp: '2026-04-17T00:00:00.000Z',
          read: false,
          color: 'blue',
          summary: 'Queued summary',
        },
      ],
      () => 'fixed-id',
    )

    expect(queued).toEqual([
      {
        id: 'fixed-id',
        from: 'alice',
        text: 'Queued message',
        timestamp: '2026-04-17T00:00:00.000Z',
        status: 'pending',
        color: 'blue',
        summary: 'Queued summary',
      },
    ])
  })
})
