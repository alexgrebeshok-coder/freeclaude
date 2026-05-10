import { app } from 'electron';
import { EventEmitter } from 'events';
import { spawn, ChildProcess, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import {
  FreeClaudeSendRequestSchema,
  FreeClaudeSendRequest,
  ChatHistoryEntry
} from '../shared/ipc-contract';
import { getLogger } from './logger';
import {
  ProviderConfigStore,
  ProviderConfigUpdate,
  ProviderConnectionTestRequest
} from './provider-config';

interface ResolvedCli {
  command: string;
  baseArgs: string[];
  source: string;
}

interface StreamJsonContentPart {
  type?: string;
  text?: string;
}

interface StreamJsonMessage {
  content?: StreamJsonContentPart[];
}

interface StreamJsonEvent {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  message?: StreamJsonMessage;
  result?: string;
  session_id?: string;
}

interface QueuedRequest {
  request: FreeClaudeSendRequest;
  requestId: string;
}

/**
 * Serialize conversation history into the leading part of the prompt when
 * no sessionId is available. Format:
 *
 *   === PREVIOUS CONVERSATION ===
 *   [User]: <content>
 *   [Assistant]: <content>
 *   ...
 *   === END PREVIOUS CONVERSATION ===
 *
 *   <current prompt>
 *
 * Roles other than 'user'/'assistant' are labeled by their raw role string.
 * When a sessionId is present the CLI's --resume flag handles history natively,
 * so this path is skipped.
 */
function buildPromptWithHistory(history: ChatHistoryEntry[], currentPrompt: string): string {
  if (history.length === 0) {
    return currentPrompt;
  }
  const roleLabel = (role: string): string => {
    if (role === 'user') return '[User]';
    if (role === 'assistant') return '[Assistant]';
    return `[${role}]`;
  };
  const turns = history.map((entry) => `${roleLabel(entry.role)}: ${entry.content}`).join('\n');
  return `=== PREVIOUS CONVERSATION ===\n${turns}\n=== END PREVIOUS CONVERSATION ===\n\n${currentPrompt}`;
}

export class FreeClaudeBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = '';
  private cli: ResolvedCli | null = null;
  private wasCancelled = false;
  private emittedDone = false;
  private currentRequestId: string | null = null;
  private queue: QueuedRequest[] = [];
  private hangTimer: NodeJS.Timeout | null = null;
  private readonly providerStore = new ProviderConfigStore(
    this.getConfigPath(),
    this.getLocalFreeClaudeConfigPath()
  );

  private readonly HANG_TIMEOUT_MS = 60_000;
  private readonly MAX_BUFFER_BYTES = 5 * 1024 * 1024; // 5 MB

  private getConfigPath(): string {
    return path.join(app.getPath('userData'), 'config', 'settings.json');
  }

  private getLocalFreeClaudeConfigPath(): string {
    return path.join(os.homedir(), '.freeclaude.json');
  }

  private commandExists(command: string): boolean {
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(lookup, [command], { stdio: 'ignore' });
    return result.status === 0;
  }

  private resolveCli(): ResolvedCli | null {
    const envPath = process.env.FREECLAUDE_PATH;
    if (envPath) {
      return { command: envPath, baseArgs: [], source: 'FREECLAUDE_PATH' };
    }

    const candidates = [
      path.join(os.homedir(), '.freeclaude', 'bin', 'freeclaude'),
      '/opt/homebrew/bin/freeclaude',
      '/usr/local/bin/freeclaude',
      path.join(os.homedir(), '.local', 'bin', 'freeclaude'),
      path.join(os.homedir(), 'bin', 'freeclaude')
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return { command: candidate, baseArgs: [], source: candidate };
      }
    }

    if (this.commandExists('freeclaude')) {
      return { command: 'freeclaude', baseArgs: [], source: 'PATH' };
    }

    if (this.commandExists('npx')) {
      return { command: 'npx', baseArgs: ['freeclaude'], source: 'npx' };
    }

    return null;
  }

  private resolveRuntimeConfig() {
    return this.providerStore.resolveRuntimeConfig();
  }

  getProvidersInfo(): unknown {
    const cli = this.cli || this.resolveCli();
    return this.providerStore.getProvidersPayload(cli?.command || null, cli?.source || null);
  }

  getModels(providerId?: string): string[] {
    return this.providerStore.getModels(providerId);
  }

  getResolvedConfig(): Record<string, unknown> {
    const cli = this.cli || this.resolveCli();
    return this.providerStore.getResolvedConfigSummary(cli?.command || null, cli?.source || null);
  }

  saveProviderConfig(update: ProviderConfigUpdate): unknown {
    return this.providerStore.saveProviderConfig(update);
  }

  setProviderApiKey(providerId: string, apiKey: string): unknown {
    return this.providerStore.setProviderApiKey(providerId, apiKey);
  }

  clearProviderApiKey(providerId: string): unknown {
    return this.providerStore.clearProviderApiKey(providerId);
  }

  setActiveProvider(providerId: string, model?: string): unknown {
    return this.providerStore.setActiveProvider(providerId, model);
  }

  testProviderConnection(request: ProviderConnectionTestRequest): Promise<unknown> {
    return this.providerStore.testConnection(request);
  }

  start(): void {
    this.cli = this.resolveCli();

    if (!this.cli) {
      this.emit('error', { error: 'FreeClaude CLI not found. Please install it first.' });
      return;
    }

    this.emit('ready');
  }

  // ---------------------------------------------------------------------------
  // Event helpers — stamp every outgoing event with the current requestId
  // ---------------------------------------------------------------------------

  private emitMessage(payload: Record<string, unknown>): void {
    this.emit(
      'message',
      this.currentRequestId ? { requestId: this.currentRequestId, ...payload } : payload
    );
  }

  private emitError(errorMsg: string): void {
    const payload: Record<string, unknown> = { error: errorMsg };
    if (this.currentRequestId) {
      payload.requestId = this.currentRequestId;
    }
    this.emit('error', payload);
  }

  // ---------------------------------------------------------------------------
  // Hang detector — emits a warning (not error) if no stdout for 60 s
  // ---------------------------------------------------------------------------

  private resetHangTimer(): void {
    this.clearHangTimer();
    const requestId = this.currentRequestId;
    this.hangTimer = setTimeout(() => {
      this.hangTimer = null;
      getLogger()
        .scoped('freeclaude-bridge')
        .warn('no stdout output from CLI for 60s', { requestId });
      this.emitMessage({ type: 'warning', warning: 'no output for 60s' });
    }, this.HANG_TIMEOUT_MS);
  }

  private clearHangTimer(): void {
    if (this.hangTimer) {
      clearTimeout(this.hangTimer);
      this.hangTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Stream parsing
  // ---------------------------------------------------------------------------

  private parseEvent(line: string): void {
    let event: StreamJsonEvent;
    try {
      event = JSON.parse(line) as StreamJsonEvent;
    } catch {
      // Skip malformed JSON lines without crashing.
      return;
    }

    if (event.session_id) {
      this.emitMessage({ type: 'session', sessionId: event.session_id });
    }

    if (event.is_error) {
      this.emitError(event.result || 'FreeClaude request failed.');
      return;
    }

    if (event.type === 'assistant') {
      const content = (event.message?.content || [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');

      if (content) {
        this.emitMessage({ type: 'content', content });
      }
      return;
    }

    if (event.type === 'result') {
      if (event.is_error) {
        this.emitError(event.result || 'FreeClaude request failed.');
        return;
      }

      this.emittedDone = true;
      this.emitMessage({ type: 'done', done: true });
    }
  }

  private handleData(data: string): void {
    this.buffer += data;

    // Cap total buffer to MAX_BUFFER_BYTES; keep the tail and advance past the
    // first partial line so that subsequent JSONL parsing stays valid.
    if (Buffer.byteLength(this.buffer, 'utf-8') > this.MAX_BUFFER_BYTES) {
      getLogger()
        .scoped('freeclaude-bridge')
        .warn('stdout buffer exceeded 5 MB limit, truncating head', {
          requestId: this.currentRequestId
        });
      const buf = Buffer.from(this.buffer, 'utf-8');
      const sliced = buf.slice(buf.length - this.MAX_BUFFER_BYTES).toString('utf-8');
      const firstNewline = sliced.indexOf('\n');
      this.buffer = firstNewline >= 0 ? sliced.slice(firstNewline + 1) : sliced;
    }

    // Any data resets the hang timer.
    this.resetHangTimer();

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        continue;
      }
      this.parseEvent(trimmedLine);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Send a request to the FreeClaude CLI.
   *
   * Validates the payload with `FreeClaudeSendRequestSchema`. On validation
   * failure emits an error event and returns early.
   *
   * If a child process is already running the request is placed in a FIFO
   * queue and started automatically when the active request completes.
   */
  send(message: unknown): void {
    if (!this.cli) {
      this.start();
    }
    if (!this.cli) {
      return;
    }

    const log = getLogger().scoped('freeclaude-bridge');
    const parseResult = FreeClaudeSendRequestSchema.safeParse(message);
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ');
      log.warn('invalid freeclaude:send payload', { issues });
      this.emit('error', { error: `Invalid request: ${issues}` });
      return;
    }

    const request = parseResult.data;
    const requestId = request.requestId || crypto.randomUUID();

    if (this.process) {
      log.info('queueing request (child already running)', { requestId });
      this.queue.push({ request, requestId });
      return;
    }

    this._spawnRequest(request, requestId);
  }

  /**
   * Cancel a running or queued request.
   *
   * - `cancel()` — cancel the current request AND clear the queue (existing
   *   behaviour from the preload/IPC path).
   * - `cancel(requestId)` — cancel only the matching request; if it is the
   *   current one, kick off the next queued item; if it is queued, remove it.
   */
  cancel(requestId?: string): void {
    if (requestId === undefined) {
      if (this.process) {
        this.wasCancelled = true;
        this.clearHangTimer();
        this.process.kill('SIGTERM');
        this.process = null;
      }
      this.queue = [];
      this.buffer = '';
      this.currentRequestId = null;
    } else if (this.currentRequestId === requestId) {
      if (this.process) {
        this.wasCancelled = true;
        this.clearHangTimer();
        this.process.kill('SIGTERM');
        this.process = null;
      }
      this.buffer = '';
      this.currentRequestId = null;
      const next = this.queue.shift();
      if (next) {
        this._spawnRequest(next.request, next.requestId);
      }
    } else {
      this.queue = this.queue.filter((item) => item.requestId !== requestId);
    }
  }

  stop(): void {
    this.cancel();
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  // ---------------------------------------------------------------------------
  // Internal spawn
  // ---------------------------------------------------------------------------

  private _spawnRequest(request: FreeClaudeSendRequest, requestId: string): void {
    const log = getLogger().scoped('freeclaude-bridge');
    const { content, sessionId, history } = request;

    // Build the final prompt:
    //   - sessionId present → use --resume; the CLI carries the session transcript.
    //   - sessionId absent AND history non-empty → prepend a serialized transcript
    //     (see buildPromptWithHistory for the exact delimited format).
    const prompt =
      !sessionId && history && history.length > 0
        ? buildPromptWithHistory(history, content)
        : content;

    const runtimeConfig = this.resolveRuntimeConfig();
    this.wasCancelled = false;
    this.buffer = '';
    this.emittedDone = false;
    this.currentRequestId = requestId;

    const args = [
      ...this.cli!.baseArgs,
      ...(sessionId ? ['--resume', sessionId] : []),
      '-p',
      '--output-format',
      'stream-json',
      prompt
    ];

    const env = {
      ...process.env,
      ...runtimeConfig.env
    };

    log.info('spawning CLI', {
      requestId,
      sessionId: sessionId || null,
      historyTurns: history?.length ?? 0
    });

    this.process = spawn(this.cli!.command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });

    // Start hang timer — emits a warning event if no stdout for HANG_TIMEOUT_MS.
    this.resetHangTimer();

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const diagnostic = data.toString().trim();
      if (diagnostic) {
        log.debug('CLI stderr', { diagnostic, requestId });
        this.emitMessage({ type: 'diagnostic', diagnostic });
      }
    });

    this.process.on('error', (error) => {
      log.error('CLI process error', { message: error.message, requestId });
      this.clearHangTimer();
      this.emitError(error.message);
    });

    this.process.on('exit', (code) => {
      this.clearHangTimer();

      const capturedRequestId = this.currentRequestId;
      const shouldReportError = !this.wasCancelled && code !== 0 && code !== null;

      if (this.buffer.trim()) {
        this.parseEvent(this.buffer.trim());
      }

      const shouldComplete = !this.wasCancelled && !this.emittedDone;

      this.process = null;
      this.buffer = '';
      this.wasCancelled = false;
      this.emittedDone = false;
      this.currentRequestId = null;

      if (shouldReportError) {
        this.emit('error', {
          requestId: capturedRequestId,
          error: `FreeClaude CLI exited with code ${code}`
        });
      } else if (shouldComplete) {
        this.emit('message', { type: 'done', requestId: capturedRequestId, done: true });
      }

      // Pop and start the next queued request.
      const next = this.queue.shift();
      if (next) {
        this._spawnRequest(next.request, next.requestId);
      }
    });
  }
}
