import { describe, expect, it } from 'vitest';
import {
  EventChannels,
  EventSchemas,
  FreeClaudeSendRequestSchema,
  InvokeChannels,
  InvokeSchemas,
  IpcContractError,
  ShellOpenExternalRequestSchema,
  parseInvoke,
  validateEvent
} from '../../src/shared/ipc-contract';

describe('shared/ipc-contract', () => {
  it('exposes the same channel names as schema keys', () => {
    for (const channel of Object.values(InvokeChannels)) {
      expect(InvokeSchemas).toHaveProperty(channel);
    }
    for (const channel of Object.values(EventChannels)) {
      expect(EventSchemas).toHaveProperty(channel);
    }
  });

  it('rejects unknown shell.openExternal protocols', () => {
    const result = ShellOpenExternalRequestSchema.safeParse(['javascript:alert(1)']);
    expect(result.success).toBe(false);
  });

  it('accepts https and mailto for shell.openExternal', () => {
    expect(ShellOpenExternalRequestSchema.safeParse(['https://freeclaude.dev']).success).toBe(true);
    expect(ShellOpenExternalRequestSchema.safeParse(['mailto:hi@example.com']).success).toBe(true);
  });

  it('parseInvoke throws IpcContractError on malformed payloads', () => {
    expect(() =>
      parseInvoke(InvokeChannels.freeclaudeSend, FreeClaudeSendRequestSchema, { content: '' })
    ).toThrow(IpcContractError);
  });

  it('FreeClaudeSendRequestSchema accepts history + requestId', () => {
    const ok = FreeClaudeSendRequestSchema.safeParse({
      content: 'Hello',
      requestId: 'req-1',
      sessionId: 'sess-1',
      history: [{ role: 'user', content: 'prev' }]
    });
    expect(ok.success).toBe(true);
  });

  it('validateEvent returns parsed payload for valid events and warns on invalid', () => {
    let warned = false;
    const valid = validateEvent(
      EventChannels.terminalData,
      EventSchemas[EventChannels.terminalData],
      { id: 't1', data: 'hello' },
      () => {
        warned = true;
      }
    );
    expect(valid).toEqual({ id: 't1', data: 'hello' });
    expect(warned).toBe(false);

    validateEvent(
      EventChannels.terminalData,
      EventSchemas[EventChannels.terminalData],
      { id: 1, data: 2 },
      () => {
        warned = true;
      }
    );
    expect(warned).toBe(true);
  });
});
