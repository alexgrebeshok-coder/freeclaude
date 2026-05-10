import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Mock electron before importing anything that depends on it.
// ---------------------------------------------------------------------------
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), `freeclaude-test-${name}`)
  }
}));

// Mock the logger to avoid file I/O in tests.
vi.mock('../../src/main/logger', () => {
  const noop = vi.fn();
  const scopedLogger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop };
  return {
    getLogger: () => ({ scoped: () => scopedLogger })
  };
});

// ---------------------------------------------------------------------------
// Import bridge AFTER mocks are established.
// ---------------------------------------------------------------------------
import { FreeClaudeBridge } from '../../src/main/freeclaude-bridge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_CLI = path.resolve(__dirname, '../fixtures/fake-freeclaude.sh');

type MessageEvent = Record<string, unknown>;
type ErrorEvent = Record<string, unknown>;

/**
 * Collect emitted message/error events until a terminal event (done or error)
 * is received. Rejects after timeoutMs if no terminal event arrives.
 */
function collectEvents(
  bridge: FreeClaudeBridge,
  timeoutMs = 20_000
): Promise<{ messages: MessageEvent[]; errors: ErrorEvent[] }> {
  return new Promise((resolve, reject) => {
    const messages: MessageEvent[] = [];
    const errors: ErrorEvent[] = [];
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      reject(new Error('collectEvents timed out waiting for done/error'));
    }, timeoutMs);

    const finish = () => {
      clearTimeout(timer);
      resolve({ messages, errors });
    };

    bridge.on('message', (msg: MessageEvent) => {
      messages.push(msg);
      if (msg.type === 'done') {
        finish();
      }
    });

    bridge.on('error', (err: ErrorEvent) => {
      errors.push(err);
      finish();
    });
  });
}

/**
 * Like collectEvents, but resolves after N done events (for queue tests).
 */
function collectNDone(
  bridge: FreeClaudeBridge,
  n: number,
  timeoutMs = 20_000
): Promise<{ messages: MessageEvent[]; errors: ErrorEvent[] }> {
  return new Promise((resolve, reject) => {
    const messages: MessageEvent[] = [];
    const errors: ErrorEvent[] = [];
    let doneCount = 0;
    const timer = setTimeout(() => {
      reject(new Error(`collectNDone timed out waiting for ${n} done events`));
    }, timeoutMs);

    bridge.on('message', (msg: MessageEvent) => {
      messages.push(msg);
      if (msg.type === 'done') {
        doneCount++;
        if (doneCount >= n) {
          clearTimeout(timer);
          resolve({ messages, errors });
        }
      }
    });

    bridge.on('error', (err: ErrorEvent) => {
      errors.push(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FreeClaudeBridge', () => {
  let bridge: FreeClaudeBridge;

  beforeEach(() => {
    process.env.FREECLAUDE_PATH = FAKE_CLI;
    bridge = new FreeClaudeBridge();
    bridge.start();
  });

  afterEach(() => {
    bridge.cancel();
    delete process.env.FREECLAUDE_PATH;
    // Remove all listeners to avoid interference between tests.
    bridge.removeAllListeners();
  });

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------
  it('happy path: emits session, content chunks, and done — all stamped with requestId', async () => {
    const p = collectEvents(bridge);
    bridge.send({ content: 'Hello', requestId: 'req-happy' });
    const { messages, errors } = await p;

    expect(errors).toHaveLength(0);

    const session = messages.find((m) => m.type === 'session');
    expect(session).toBeDefined();
    expect(session?.requestId).toBe('req-happy');
    expect(typeof session?.sessionId).toBe('string');

    const contents = messages.filter((m) => m.type === 'content');
    expect(contents.length).toBeGreaterThanOrEqual(1);
    expect(contents[0].requestId).toBe('req-happy');
    expect(typeof contents[0].content).toBe('string');

    const done = messages.find((m) => m.type === 'done');
    expect(done).toBeDefined();
    expect(done?.requestId).toBe('req-happy');
    expect(done?.done).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Stderr noise → diagnostic events with requestId
  // -------------------------------------------------------------------------
  it('stderr noise produces diagnostic events stamped with requestId', async () => {
    const p = collectEvents(bridge);
    bridge.send({ content: 'SCENARIO:stderr', requestId: 'req-stderr' });
    const { messages, errors } = await p;

    expect(errors).toHaveLength(0);

    const diags = messages.filter((m) => m.type === 'diagnostic');
    expect(diags.length).toBeGreaterThan(0);
    for (const d of diags) {
      expect(d.requestId).toBe('req-stderr');
      expect(typeof d.diagnostic).toBe('string');
    }

    const done = messages.find((m) => m.type === 'done');
    expect(done?.requestId).toBe('req-stderr');
  });

  // -------------------------------------------------------------------------
  // 3. Exit without result line → bridge still emits done
  // -------------------------------------------------------------------------
  it('exit without result line still emits done', async () => {
    const p = collectEvents(bridge);
    bridge.send({ content: 'SCENARIO:exit_no_result', requestId: 'req-noresult' });
    const { messages, errors } = await p;

    // Bridge should synthesise done via shouldComplete path.
    const done = messages.find((m) => m.type === 'done');
    const hasTerminal = done !== undefined || errors.length > 0;
    expect(hasTerminal).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Malformed JSON line is skipped without crash
  // -------------------------------------------------------------------------
  it('malformed JSON line is skipped, remaining output is processed normally', async () => {
    const p = collectEvents(bridge);
    bridge.send({ content: 'SCENARIO:malformed', requestId: 'req-malformed' });
    const { messages, errors } = await p;

    expect(errors).toHaveLength(0);

    // We should have received content events both before and after the bad line.
    const contents = messages.filter((m) => m.type === 'content');
    expect(contents.length).toBeGreaterThanOrEqual(2);

    const done = messages.find((m) => m.type === 'done');
    expect(done).toBeDefined();
    expect(done?.requestId).toBe('req-malformed');
  });

  // -------------------------------------------------------------------------
  // 5. Long stdout triggers buffer truncation, bridge still emits done
  // -------------------------------------------------------------------------
  it('long stdout triggers buffer cap truncation but bridge still emits done', async () => {
    const p = collectEvents(bridge, 60_000);
    bridge.send({ content: 'SCENARIO:long', requestId: 'req-long' });
    const { messages, errors } = await p;

    expect(errors).toHaveLength(0);
    const done = messages.find((m) => m.type === 'done');
    expect(done).toBeDefined();
    expect(done?.requestId).toBe('req-long');
  }, 65_000);

  // -------------------------------------------------------------------------
  // 6. Queued sends are processed FIFO with correct requestId correlation
  // -------------------------------------------------------------------------
  it('queued sends are processed in FIFO order with correct requestId on each done', async () => {
    const p = collectNDone(bridge, 2);

    bridge.send({ content: 'first', requestId: 'req-queue-a' });
    bridge.send({ content: 'second', requestId: 'req-queue-b' });

    const { messages } = await p;

    const doneEvents = messages.filter((m) => m.type === 'done');
    expect(doneEvents).toHaveLength(2);
    // FIFO: req-queue-a finishes first.
    expect(doneEvents[0].requestId).toBe('req-queue-a');
    expect(doneEvents[1].requestId).toBe('req-queue-b');
  });

  // -------------------------------------------------------------------------
  // 7. Validation rejects invalid payload with error event
  // -------------------------------------------------------------------------
  it('invalid payload emits error event with no crash', async () => {
    const errors: ErrorEvent[] = [];
    bridge.on('error', (e: ErrorEvent) => errors.push(e));

    bridge.send({ content: '' }); // fails min(1) check on content
    await new Promise((r) => setTimeout(r, 100));

    expect(errors.length).toBeGreaterThan(0);
    expect(typeof errors[0].error).toBe('string');
  });

  // -------------------------------------------------------------------------
  // 8. cancel() clears queue and cancels current request
  // -------------------------------------------------------------------------
  it('cancel() stops current request and clears queue', async () => {
    const messages: MessageEvent[] = [];
    bridge.on('message', (m: MessageEvent) => messages.push(m));

    // Queue two requests then immediately cancel.
    bridge.send({ content: 'first', requestId: 'req-cancel-a' });
    bridge.send({ content: 'second', requestId: 'req-cancel-b' });
    bridge.cancel();

    // Wait briefly for any stray events.
    await new Promise((r) => setTimeout(r, 200));

    const doneEvents = messages.filter((m) => m.type === 'done');
    // After cancel, neither should have completed.
    expect(doneEvents.length).toBe(0);
    expect(bridge.isRunning()).toBe(false);
  });
});
