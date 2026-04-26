import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

interface FreeClaudeMessage {
  type: 'message' | 'tool' | 'error' | 'done';
  content?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  error?: string;
}

export class FreeClaudeBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = '';
  private messageQueue: unknown[] = [];
  private isReady = false;

  private getConfigPath(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, '.freeclaude', 'config.json');
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

  start(): void {
    if (this.process) {
      return;
    }

    const cliPath = '/opt/homebrew/bin/freeclaude';

    // Check if freeclaude exists
    if (!fs.existsSync(cliPath)) {
      // Try other common locations
      const altPaths = [
        '/usr/local/bin/freeclaude',
        path.join(os.homedir(), '.local', 'bin', 'freeclaude'),
        path.join(os.homedir(), 'bin', 'freeclaude')
      ];

      for (const alt of altPaths) {
        if (fs.existsSync(alt)) {
          return this.startWithPath(alt);
        }
      }

      this.emit('error', { error: 'FreeClaude CLI not found. Please install it first.' });
      return;
    }

    this.startWithPath(cliPath);
  }

  private startWithPath(cliPath: string): void {
    const config = this.loadConfig();

    this.process = spawn(cliPath, ['--json-rpc'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FREECLAUDE_API_KEY: config.api_key as string || process.env.FREECLAUDE_API_KEY || '',
        FREECLAUDE_PROVIDER: config.provider as string || 'glm',
        FREECLAUDE_MODEL: config.model as string || 'glm-5.1'
      }
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const error = data.toString();
      console.error('FreeClaude stderr:', error);
      this.emit('error', { error });
    });

    this.process.on('error', (error) => {
      console.error('FreeClaude process error:', error);
      this.emit('error', { error: error.message });
    });

    this.process.on('exit', (code) => {
      console.log('FreeClaude process exited with code:', code);
      this.process = null;
      this.isReady = false;

      if (code !== 0 && code !== null) {
        this.emit('error', { error: `FreeClaude CLI exited with code ${code}` });
      }
    });

    this.isReady = true;

    // Send any queued messages
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.sendRaw(message);
      }
    }

    this.emit('ready');
  }

  private handleData(data: string): void {
    this.buffer += data;

    // Process complete JSON objects (newline-delimited)
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as FreeClaudeMessage;
          this.emit('message', message);
        } catch (error) {
          console.error('Failed to parse message:', line, error);
          this.emit('error', { error: 'Failed to parse response from FreeClaude' });
        }
      }
    }
  }

  send(message: unknown): void {
    if (!this.isReady || !this.process) {
      this.messageQueue.push(message);
      return;
    }
    this.sendRaw(message);
  }

  private sendRaw(message: unknown): void {
    if (this.process?.stdin) {
      const json = JSON.stringify(message);
      this.process.stdin.write(json + '\n');
    }
  }

  cancel(): void {
    this.send({ type: 'cancel' });
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.isReady = false;
    this.messageQueue = [];
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
