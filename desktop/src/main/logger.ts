import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/**
 * Tiny, dependency-free JSONL logger for the main process.
 *
 * - Writes to `<userData>/logs/freeclaude.log` (creates the dir if missing).
 * - Rotates synchronously when the active file exceeds `maxBytes`.
 * - Keeps `maxFiles` rotated copies (`freeclaude.log.1`, `.2`, ...).
 * - Mirrors records to the console in development.
 *
 * The renderer never writes to this file directly. The main process pipes
 * lifecycle / IPC contract / crash events here so that a single zip from
 * Settings → "Send diagnostics" gives us everything for triage.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LoggerOptions {
  filePath?: string;
  maxBytes?: number;
  maxFiles?: number;
  mirrorToConsole?: boolean;
}

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  scope?: string;
  // Arbitrary structured payload. Stringified safely.
  data?: unknown;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
};

export class Logger {
  private readonly filePath: string;
  private readonly dir: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly mirrorToConsole: boolean;
  private minLevel: LogLevel;
  private stream: fs.WriteStream | null = null;
  private currentSize = 0;
  private rotating = false;

  constructor(options: LoggerOptions = {}) {
    const defaultDir = (() => {
      try {
        return path.join(app.getPath('logs'));
      } catch {
        return path.join(app.getPath('userData'), 'logs');
      }
    })();

    this.filePath = options.filePath || path.join(defaultDir, 'freeclaude.log');
    this.dir = path.dirname(this.filePath);
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024; // 2 MB
    this.maxFiles = options.maxFiles ?? 5;
    this.mirrorToConsole = options.mirrorToConsole ?? !app.isPackaged;
    this.minLevel = process.env.FREECLAUDE_LOG_LEVEL ? coerceLevel(process.env.FREECLAUDE_LOG_LEVEL) : 'info';

    this.ensureStream();
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getDir(): string {
    return this.dir;
  }

  trace(msg: string, data?: unknown): void {
    this.write('trace', msg, undefined, data);
  }
  debug(msg: string, data?: unknown): void {
    this.write('debug', msg, undefined, data);
  }
  info(msg: string, data?: unknown): void {
    this.write('info', msg, undefined, data);
  }
  warn(msg: string, data?: unknown): void {
    this.write('warn', msg, undefined, data);
  }
  error(msg: string, data?: unknown): void {
    this.write('error', msg, undefined, data);
  }
  fatal(msg: string, data?: unknown): void {
    this.write('fatal', msg, undefined, data);
  }

  scoped(scope: string): ScopedLogger {
    return new ScopedLogger(this, scope);
  }

  /** @internal */
  writeRaw(level: LogLevel, msg: string, scope: string | undefined, data: unknown): void {
    this.write(level, msg, scope, data);
  }

  private write(level: LogLevel, msg: string, scope: string | undefined, data: unknown): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) {
      return;
    }
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg,
      scope,
      data: safeData(data)
    };
    const line = stringifyEntry(entry);
    if (this.mirrorToConsole) {
      const consoleFn =
        level === 'error' || level === 'fatal'
          ? console.error
          : level === 'warn'
            ? console.warn
            : level === 'debug' || level === 'trace'
              ? console.debug
              : console.log;
      consoleFn(`[${level}]${scope ? ` [${scope}]` : ''} ${msg}`, data ?? '');
    }
    try {
      this.ensureStream();
      this.stream?.write(line);
      this.currentSize += Buffer.byteLength(line);
      if (this.currentSize >= this.maxBytes) {
        this.rotate();
      }
    } catch (err) {
      // Logger must never throw upward into Electron lifecycle.
      console.error('[logger] failed to write:', err);
    }
  }

  private ensureStream(): void {
    if (this.stream) {
      return;
    }
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.stream = fs.createWriteStream(this.filePath, { flags: 'a', encoding: 'utf-8' });
      try {
        this.currentSize = fs.statSync(this.filePath).size;
      } catch {
        this.currentSize = 0;
      }
      this.stream.on('error', (err) => {
        console.error('[logger] stream error:', err);
        this.stream = null;
      });
    } catch (err) {
      console.error('[logger] failed to open stream:', err);
      this.stream = null;
    }
  }

  private rotate(): void {
    if (this.rotating) {
      return;
    }
    this.rotating = true;
    try {
      this.stream?.end();
      this.stream = null;
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const src = `${this.filePath}.${i}`;
        const dst = `${this.filePath}.${i + 1}`;
        if (fs.existsSync(src)) {
          try {
            fs.renameSync(src, dst);
          } catch {
            /* ignore */
          }
        }
      }
      const oldest = `${this.filePath}.${this.maxFiles}`;
      if (fs.existsSync(oldest)) {
        try {
          fs.unlinkSync(oldest);
        } catch {
          /* ignore */
        }
      }
      try {
        fs.renameSync(this.filePath, `${this.filePath}.1`);
      } catch {
        /* ignore */
      }
      this.currentSize = 0;
      this.ensureStream();
    } finally {
      this.rotating = false;
    }
  }
}

export class ScopedLogger {
  constructor(private readonly parent: Logger, private readonly scope: string) {}
  trace(msg: string, data?: unknown): void {
    this.parent.writeRaw('trace', msg, this.scope, data);
  }
  debug(msg: string, data?: unknown): void {
    this.parent.writeRaw('debug', msg, this.scope, data);
  }
  info(msg: string, data?: unknown): void {
    this.parent.writeRaw('info', msg, this.scope, data);
  }
  warn(msg: string, data?: unknown): void {
    this.parent.writeRaw('warn', msg, this.scope, data);
  }
  error(msg: string, data?: unknown): void {
    this.parent.writeRaw('error', msg, this.scope, data);
  }
  fatal(msg: string, data?: unknown): void {
    this.parent.writeRaw('fatal', msg, this.scope, data);
  }
  scoped(child: string): ScopedLogger {
    return new ScopedLogger(this.parent, `${this.scope}/${child}`);
  }
}

function safeData(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function stringifyEntry(entry: LogEntry): string {
  try {
    return `${JSON.stringify(entry)}\n`;
  } catch {
    // Circular structures: fall back to a coarse stringify.
    const safe = {
      ...entry,
      data: typeof entry.data === 'object' ? '[unserializable]' : entry.data
    };
    return `${JSON.stringify(safe)}\n`;
  }
}

function coerceLevel(value: string): LogLevel {
  const lower = value.toLowerCase() as LogLevel;
  return (LEVEL_RANK as Record<string, number>)[lower] !== undefined ? lower : 'info';
}

let singleton: Logger | null = null;

export function getLogger(): Logger {
  if (!singleton) {
    singleton = new Logger();
  }
  return singleton;
}
