import { app } from 'electron';
import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

interface FreeClaudeRequest {
  type?: string;
  content?: string;
  sessionId?: string;
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

export class FreeClaudeBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = '';
  private cliPath: string | null = null;
  private wasCancelled = false;

  private getConfigPath(): string {
    return path.join(app.getPath('userData'), 'config', 'settings.json');
  }

  private loadConfig(): Record<string, unknown> {
    try {
      const configPath = this.getConfigPath();
      if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
    return {};
  }

  private resolveCliPath(): string | null {
    const primaryPath = '/opt/homebrew/bin/freeclaude';
    const altPaths = [
      '/usr/local/bin/freeclaude',
      path.join(os.homedir(), '.local', 'bin', 'freeclaude'),
      path.join(os.homedir(), 'bin', 'freeclaude')
    ];

    for (const candidate of [primaryPath, ...altPaths]) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  start(): void {
    this.cliPath = this.resolveCliPath();

    if (!this.cliPath) {
      this.emit('error', { error: 'FreeClaude CLI not found. Please install it first.' });
      return;
    }

    this.emit('ready');
  }

  private parseEvent(line: string): void {
    let event: StreamJsonEvent;

    try {
      event = JSON.parse(line) as StreamJsonEvent;
    } catch {
      return;
    }

    if (event.session_id) {
      this.emit('message', { type: 'session', sessionId: event.session_id });
    }

    if (event.is_error) {
      this.emit('error', { error: event.result || 'FreeClaude request failed.' });
      return;
    }

    if (event.type === 'assistant') {
      const content = (event.message?.content || [])
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');

      if (content) {
        this.emit('message', { type: 'content', content });
      }
      return;
    }

    if (event.type === 'result') {
      if (event.is_error) {
        this.emit('error', { error: event.result || 'FreeClaude request failed.' });
        return;
      }

      this.emit('message', { type: 'done', done: true });
    }
  }

  private handleData(data: string): void {
    this.buffer += data;
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

  send(message: unknown): void {
    if (!this.cliPath) {
      this.start();
    }

    if (!this.cliPath) {
      return;
    }

    if (this.process) {
      this.emit('error', { error: 'A FreeClaude request is already running.' });
      return;
    }

    const request = message as FreeClaudeRequest;
    const prompt = typeof request.content === 'string' ? request.content.trim() : '';
    const sessionId = typeof request.sessionId === 'string' ? request.sessionId : '';

    if (!prompt) {
      this.emit('error', { error: 'Cannot send an empty message.' });
      return;
    }

    const config = this.loadConfig();
    this.wasCancelled = false;
    this.buffer = '';

    const args = [
      ...(sessionId ? ['--resume', sessionId] : []),
      '-p',
      '--verbose',
      '--output-format',
      'stream-json',
      prompt
    ];

    this.process = spawn(this.cliPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FREECLAUDE_API_KEY: config.apiKey as string || config.api_key as string || process.env.FREECLAUDE_API_KEY || '',
        FREECLAUDE_PROVIDER: config.provider as string || process.env.FREECLAUDE_PROVIDER || '',
        FREECLAUDE_MODEL: config.model as string || process.env.FREECLAUDE_MODEL || ''
      }
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const error = data.toString().trim();
      if (error) {
        console.error('FreeClaude stderr:', error);
        this.emit('error', { error });
      }
    });

    this.process.on('error', (error) => {
      console.error('FreeClaude process error:', error);
      this.emit('error', { error: error.message });
    });

    this.process.on('exit', (code) => {
      const shouldReportError = !this.wasCancelled && code !== 0 && code !== null;

      this.process = null;
      this.buffer = '';
      this.wasCancelled = false;

      if (shouldReportError) {
        this.emit('error', { error: `FreeClaude CLI exited with code ${code}` });
      }
    });
  }

  cancel(): void {
    if (this.process) {
      this.wasCancelled = true;
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.buffer = '';
  }

  stop(): void {
    this.cancel();
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
