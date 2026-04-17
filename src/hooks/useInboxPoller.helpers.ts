import { randomUUID } from 'crypto'
import { TEAMMATE_MESSAGE_TAG } from '../constants/xml.js'
import type { AppState } from '../state/AppState.js'
import type { TeammateMessage } from '../utils/teammateMailbox.js'

type FormattableInboxMessage = Pick<
  TeammateMessage,
  'from' | 'text' | 'color' | 'summary'
>

type QueuedInboxMessage = AppState['inbox']['messages'][number]

export function formatInboxMessages(
  messages: readonly FormattableInboxMessage[],
): string {
  return messages
    .map(m => {
      const colorAttr = m.color ? ` color="${m.color}"` : ''
      const summaryAttr = m.summary ? ` summary="${m.summary}"` : ''
      return `<${TEAMMATE_MESSAGE_TAG} teammate_id="${m.from}"${colorAttr}${summaryAttr}>\n${m.text}\n</${TEAMMATE_MESSAGE_TAG}>`
    })
    .join('\n\n')
}

export function buildQueuedInboxMessages(
  messages: readonly TeammateMessage[],
  createId: () => string = randomUUID,
): QueuedInboxMessage[] {
  return messages.map(m => ({
    id: createId(),
    from: m.from,
    text: m.text,
    timestamp: m.timestamp,
    status: 'pending',
    color: m.color,
    summary: m.summary,
  }))
}
