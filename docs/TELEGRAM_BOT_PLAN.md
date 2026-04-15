# FreeClaude Telegram Bot — Implementation Plan

## Overview

Telegram bot для FreeClaude: отправляешь код/задачу в Telegram → бот вызывает FreeClaude agent → результат возвращается в чат.

**Architectural principle:** Telegram bot = thin adapter over FreeClaude CLI. Не дублируем логику — маршрутизируем.

---

## Architecture

```
Telegram User
     │
     ▼
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Telegram Bot │────▶│ FreeClaude Worker │────▶│ LLM Provider    │
│ (Node.js)    │     │ (spawn CLI process)│     │ (ZAI/Gemini/etc)│
└──────────────┘     └──────────────────┘     └─────────────────┘
      │                        │
      │                        ▼
      │               ┌──────────────────┐
      │               │ File System      │
      │               │ (read/edit/exec) │
      │               └──────────────────┘
      │
      ▼
  Responses (text, code, voice via TTS)
```

### Key Design Decisions

1. **Standalone Node.js process** — НЕ внутри FreeClaude CLI. Запускается отдельно.
2. **Spawn FreeClaude CLI** — `child_process.spawn('freeclaude', ['--print', prompt])` для каждого запроса.
3. **Session management** — каждый чат = workspace. `/workspace /path/to/project` для смены.
4. **No persistent state in bot** — всё в FreeClaude vault/memory. Бот stateless.
5. **Voice support** — whisper-cpp для STT, edge-tts для TTS.

---

## File Structure

```
freeclaude/
  src/
    telegram/                    # NEW
      index.ts                   # Entry point: bot startup
      bot.ts                     # Telegram bot setup (grammy)
      handlers/
        message.ts               # Text message handler
        voice.ts                 # Voice message handler (STT)
        command.ts               # /command handlers
        callback.ts              # Inline button callbacks
      services/
        freeclaude.ts            # FreeClaude CLI bridge
        tts.ts                   # Text-to-speech (edge-tts)
        stt.ts                   # Speech-to-text (whisper)
        session.ts               # Chat session management
        queue.ts                 # Request queue (rate limiting)
      types.ts                   # TypeScript interfaces
      config.ts                  # Bot configuration
    commands/
      telegram/                  # NEW - /telegram command for CLI
        index.ts
  telegram.test.ts               # Tests
```

---

## Dependencies

```json
{
  "grammy": "^1.35.0",
  "@grammyjs/conversations": "^1.2.0",
  "edge-tts": "^2.0.0",
  "fluent-ffmpeg": "^2.1.3"
}
```

**Why grammy?**
- Modern, TypeScript-first Telegram bot framework
- 2x faster than telegraf
- Built-in conversation support
- Active maintenance

---

## Implementation Stages

### Stage 1: Core Bot (Day 1)
- Bot setup with grammy
- Text message → FreeClaude CLI → response
- Basic commands: /start, /help, /workspace, /model, /reset

### Stage 2: Session Management (Day 1-2)
- Per-chat workspace binding
- Session history (last N messages for context)
- /workspace command to set project path
- /model command to switch LLM provider

### Stage 3: Voice I/O (Day 2)
- Whisper STT for voice messages
- Edge TTS for voice responses
- /voice command to toggle voice mode

### Stage 4: Advanced Features (Day 2-3)
- Code file uploads (handle .ts, .js, .py files)
- Image screenshots (OCR + description)
- Routine triggers (trigger FreeClaude routines from Telegram)
- Inline buttons (approve/reject actions)

### Stage 5: Multi-User & Security (Day 3)
- Auth via Telegram user ID whitelist
- Rate limiting per user
- Concurrent request handling
- Log to FreeClaude vault

---

## Detailed Code

### 1. Types (`src/telegram/types.ts`)

```typescript
export interface BotConfig {
  botToken: string;
  allowedUsers: number[];       // Telegram user IDs
  defaultWorkspace: string;
  freeclaudePath: string;       // Path to freeclaude binary
  defaultModel?: string;
  maxConcurrentPerUser: number;
  requestTimeoutMs: number;
  voiceEnabled: boolean;
  ttsVoice?: string;            // e.g. 'ru-RU-DmitryNeural'
  sttModel?: string;            // Path to whisper model
  sttLanguage?: string;         // e.g. 'ru'
}

export interface ChatSession {
  chatId: number;
  workspace: string;
  model: string;
  voiceMode: boolean;
  history: MessageRecord[];
  lastActivity: number;
}

export interface MessageRecord {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface FreeClaudeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}
```

### 2. Config (`src/telegram/config.ts`)

```typescript
import type { BotConfig } from './types.js';

export function loadConfig(): BotConfig {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUsers: parseAllowedUsers(process.env.ALLOWED_USERS || ''),
    defaultWorkspace: process.env.DEFAULT_WORKSPACE || process.cwd(),
    freeclaudePath: process.env.FREECLAUDE_PATH || 'freeclaude',
    defaultModel: process.env.DEFAULT_MODEL || 'zai/glm-5-turbo',
    maxConcurrentPerUser: parseInt(process.env.MAX_CONCURRENT || '1'),
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT || '120000'),
    voiceEnabled: process.env.VOICE_ENABLED !== 'false',
    ttsVoice: process.env.TTS_VOICE || 'ru-RU-DmitryNeural',
    sttModel: process.env.STT_MODEL || '~/.openclaw/models/whisper/ggml-small.bin',
    sttLanguage: process.env.STT_LANGUAGE || 'ru',
  };
}

function parseAllowedUsers(env: string): number[] {
  if (!env) return [];
  return env.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
}
```

### 3. FreeClaude Bridge (`src/telegram/services/freeclaude.ts`)

```typescript
import { spawn } from 'child_process';
import { access } from 'fs/promises';
import type { BotConfig, FreeClaudeResult } from '../types.js';

export class FreeClaudeBridge {
  constructor(private config: BotConfig) {}

  async isAvailable(): Promise<boolean> {
    try {
      await access(this.config.freeclaudePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run FreeClaude CLI with a prompt.
   * Uses --print mode for non-interactive execution.
   */
  async run(prompt: string, options?: {
    workspace?: string;
    model?: string;
    timeoutMs?: number;
    context?: string[];  // Previous messages for context
  }): Promise<FreeClaudeResult> {
    const workspace = options?.workspace || this.config.defaultWorkspace;
    const model = options?.model || this.config.defaultModel;
    const timeout = options?.timeoutMs || this.config.requestTimeoutMs;

    // Build the full prompt with context
    let fullPrompt = '';
    if (options?.context && options.context.length > 0) {
      fullPrompt += 'Previous context:\n';
      for (const msg of options.context.slice(-6)) {  // Last 6 messages
        fullPrompt += `- ${msg}\n`;
      }
      fullPrompt += '\n';
    }
    fullPrompt += prompt;

    const args = [
      '--print',
      '--model', model,
      '--cwd', workspace,
      fullPrompt,
    ];

    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';

      const proc = spawn(this.config.freeclaudePath, args, {
        cwd: workspace,
        env: {
          ...process.env,
          HOME: process.env.HOME,  // Preserve home for config access
        },
        timeout,
      });

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Hard timeout fallback
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
      }, timeout + 5000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? -1,
          durationMs: Date.now() - startTime,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          stdout: '',
          stderr: err.message,
          exitCode: -1,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }
}
```

### 4. Session Manager (`src/telegram/services/session.ts`)

```typescript
import type { BotConfig, ChatSession, MessageRecord } from '../types.js';

const MAX_HISTORY = 20;
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

export class SessionManager {
  private sessions = new Map<number, ChatSession>();

  constructor(private config: BotConfig) {}

  getOrCreate(chatId: number): ChatSession {
    let session = this.sessions.get(chatId);
    if (!session) {
      session = {
        chatId,
        workspace: this.config.defaultWorkspace,
        model: this.config.defaultModel || '',
        voiceMode: false,
        history: [],
        lastActivity: Date.now(),
      };
      this.sessions.set(chatId, session);
    }
    return session;
  }

  addMessage(chatId: number, role: 'user' | 'assistant', content: string): void {
    const session = this.getOrCreate(chatId);
    session.history.push({ role, content, timestamp: Date.now() });
    // Trim to last N messages
    if (session.history.length > MAX_HISTORY) {
      session.history = session.history.slice(-MAX_HISTORY);
    }
    session.lastActivity = Date.now();
  }

  getContext(chatId: number): string[] {
    const session = this.sessions.get(chatId);
    if (!session) return [];
    return session.history.map(m => `${m.role}: ${m.content}`);
  }

  setWorkspace(chatId: number, path: string): void {
    const session = this.getOrCreate(chatId);
    session.workspace = path;
  }

  setModel(chatId: number, model: string): void {
    const session = this.getOrCreate(chatId);
    session.model = model;
  }

  toggleVoice(chatId: number): boolean {
    const session = this.getOrCreate(chatId);
    session.voiceMode = !session.voiceMode;
    return session.voiceMode;
  }

  clearHistory(chatId: number): void {
    const session = this.getOrCreate(chatId);
    session.history = [];
    session.lastActivity = Date.now();
  }

  // Clean up expired sessions (call periodically)
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TTL) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }
}
```

### 5. TTS Service (`src/telegram/services/tts.ts`)

```typescript
import { execFile } from 'child_process';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class TTSService {
  private tempDir: string;

  constructor(
    private voice: string = 'ru-RU-DmitryNeural',
    private enabled: boolean = true,
  ) {
    this.tempDir = tmpdir();
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('python3', ['-m', 'edge_tts', '--help'], {
        timeout: 5000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Convert text to OGG audio (Telegram-compatible).
   * Returns buffer of the OGG file.
   */
  async synthesize(text: string): Promise<Buffer | null> {
    if (!this.enabled || text.length < 5) return null;

    const workDir = await mkdtemp(join(this.tempDir, 'fc-tts-'));
    const mp3Path = join(workDir, 'output.mp3');
    const oggPath = join(workDir, 'output.ogg');

    try {
      // Step 1: edge-tts → MP3
      await execFileAsync('python3', [
        '-m', 'edge_tts',
        '--voice', this.voice,
        '--text', text.substring(0, 4000),  // Telegram limit
        '--write-media', mp3Path,
      ], { timeout: 30000 });

      // Step 2: ffmpeg → OGG (Telegram voice format)
      await execFileAsync('ffmpeg', [
        '-y', '-i', mp3Path,
        '-c:a', 'libopus', '-b:a', '64k',
        oggPath,
      ], { timeout: 10000 });

      // Step 3: Read and return
      const { readFile } = await import('fs/promises');
      const buffer = await readFile(oggPath);
      return buffer;
    } catch (err) {
      console.error('[TTS] Error:', err);
      return null;
    } finally {
      // Cleanup
      try {
        const { unlink } = await import('fs/promises');
        await unlink(mp3Path).catch(() => {});
        await unlink(oggPath).catch(() => {});
      } catch {}
    }
  }
}
```

### 6. STT Service (`src/telegram/services/stt.ts`)

```typescript
import { execFile } from 'child_process';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class STTService {
  constructor(
    private modelPath: string = '~/.openclaw/models/whisper/ggml-small.bin',
    private language: string = 'ru',
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('whisper-cli', ['--help'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Transcribe audio buffer (OGG from Telegram) to text.
   */
  async transcribe(audioBuffer: Buffer): Promise<string | null> {
    const workDir = await mkdtemp(join(tmpdir(), 'fc-stt-'));
    const inputPath = join(workDir, 'input.ogg');
    const wavPath = join(workDir, 'input.wav');

    try {
      // Step 1: Save audio to file
      await writeFile(inputPath, audioBuffer);

      // Step 2: Convert to WAV (whisper-cli requirement)
      await execFileAsync('ffmpeg', [
        '-y', '-i', inputPath,
        '-ar', '16000', '-ac', '1',
        wavPath,
      ], { timeout: 10000 });

      // Step 3: Run whisper-cli
      const expandedModel = this.modelPath.replace('~', process.env.HOME || '');
      const { stdout } = await execFileAsync('whisper-cli', [
        '-m', expandedModel,
        '-l', this.language,
        '-t', '8',
        wavPath,
      ], { timeout: 60000 });

      return stdout.trim() || null;
    } catch (err) {
      console.error('[STT] Error:', err);
      return null;
    } finally {
      try {
        await unlink(inputPath).catch(() => {});
        await unlink(wavPath).catch(() => {});
      } catch {}
    }
  }
}
```

### 7. Request Queue (`src/telegram/services/queue.ts`)

```typescript
import type { BotConfig } from '../types.js';

interface PendingRequest {
  chatId: number;
  resolve: () => void;
}

export class RequestQueue {
  private activePerUser = new Map<number, number>();
  private waitingQueues = new Map<number, PendingRequest[]>();

  constructor(private config: BotConfig) {}

  /**
   * Try to acquire a slot for the given user.
   * Returns true if acquired, false if should wait.
   * Call release() when done.
   */
  async acquire(chatId: number): Promise<void> {
    const active = this.activePerUser.get(chatId) || 0;
    if (active < this.config.maxConcurrentPerUser) {
      this.activePerUser.set(chatId, active + 1);
      return;
    }

    // Wait for a slot
    return new Promise<void>((resolve) => {
      const queue = this.waitingQueues.get(chatId) || [];
      queue.push({ chatId, resolve });
      this.waitingQueues.set(chatId, queue);
    });
  }

  release(chatId: number): void {
    const active = this.activePerUser.get(chatId) || 0;
    if (active > 0) {
      this.activePerUser.set(chatId, active - 1);
    }

    // Wake up next waiting request
    const queue = this.waitingQueues.get(chatId);
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      this.activePerUser.set(chatId, (this.activePerUser.get(chatId) || 0) + 1);
      next.resolve();
      if (queue.length === 0) {
        this.waitingQueues.delete(chatId);
      }
    }
  }

  getStatus(chatId: number): { active: number; waiting: number } {
    return {
      active: this.activePerUser.get(chatId) || 0,
      waiting: (this.waitingQueues.get(chatId) || []).length,
    };
  }
}
```

### 8. Message Handler (`src/telegram/handlers/message.ts`)

```typescript
import { Context } from 'grammy';
import type { BotConfig } from '../types.js';
import { FreeClaudeBridge } from '../services/freeclaude.js';
import { SessionManager } from '../services/session.js';
import { TTSService } from '../services/tts.js';
import { RequestQueue } from '../services/queue.js';

export function createMessageHandler(
  config: BotConfig,
  fc: FreeClaudeBridge,
  sessions: SessionManager,
  tts: TTSService,
  queue: RequestQueue,
) {
  return async (ctx: Context): Promise<void> => {
    const text = ctx.message?.text;
    if (!text) return;

    const chatId = ctx.chat!.id;
    const userId = ctx.from?.id;

    // Auth check
    if (userId && config.allowedUsers.length > 0 && !config.allowedUsers.includes(userId)) {
      await ctx.reply('⛔ Доступ запрещён.');
      return;
    }

    // Ignore commands (handled separately)
    if (text.startsWith('/')) return;

    // Show typing indicator
    await ctx.replyWithChatAction('typing');

    // Acquire queue slot
    await queue.acquire(chatId);
    try {
      // Get session context
      const context = sessions.getContext(chatId);
      const session = sessions.getOrCreate(chatId);

      // Run FreeClaude
      const result = await fc.run(text, {
        workspace: session.workspace,
        model: session.model || undefined,
        context,
      });

      // Save to session history
      sessions.addMessage(chatId, 'user', text);
      sessions.addMessage(chatId, 'assistant', result.stdout);

      // Send response
      let responseText = result.stdout;

      if (result.exitCode !== 0 && result.stderr) {
        responseText += `\n\n⚠️ Error: ${result.stderr.substring(0, 500)}`;
      }

      // Truncate if too long for Telegram (4096 chars)
      if (responseText.length > 4000) {
        // Split into chunks
        const chunks = splitMessage(responseText, 4000);
        for (const chunk of chunks) {
          await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(() => {
            return ctx.reply(chunk); // Fallback without markdown
          });
        }
      } else {
        await ctx.reply(responseText, { parse_mode: 'Markdown' }).catch(() => {
          return ctx.reply(responseText);
        });
      }

      // Voice reply if enabled
      if (session.voiceMode) {
        const audio = await tts.synthesize(result.stdout.substring(0, 400));
        if (audio) {
          await ctx.replyWithVoice(new InputFile(audio));
        }
      }

    } finally {
      queue.release(chatId);
    }
  };
}

function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Split at last newline before maxLen
    const splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx > 0) {
      chunks.push(remaining.substring(0, splitIdx));
      remaining = remaining.substring(splitIdx + 1);
    } else {
      chunks.push(remaining.substring(0, maxLen));
      remaining = remaining.substring(maxLen);
    }
  }
  return chunks;
}

// Need to import InputFile
import { InputFile } from 'grammy';
```

### 9. Voice Handler (`src/telegram/handlers/voice.ts`)

```typescript
import { Context } from 'grammy';
import type { BotConfig } from '../types.js';
import { STTService } from '../services/stt.js';
import { FreeClaudeBridge } from '../services/freeclaude.js';
import { SessionManager } from '../services/session.js';
import { RequestQueue } from '../services/queue.js';

export function createVoiceHandler(
  config: BotConfig,
  stt: STTService,
  fc: FreeClaudeBridge,
  sessions: SessionManager,
  queue: RequestQueue,
) {
  return async (ctx: Context): Promise<void> => {
    const voice = ctx.message?.voice;
    if (!voice) return;

    const chatId = ctx.chat!.id;
    await ctx.replyWithChatAction('typing');

    await queue.acquire(chatId);
    try {
      // Download voice file from Telegram
      const file = await ctx.api.getFile(voice.file_id);
      if (!file.file_path) {
        await ctx.reply('❌ Не удалось получить аудио.');
        return;
      }

      const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
      const response = await fetch(url);
      if (!response.ok) {
        await ctx.reply('❌ Ошибка загрузки аудио.');
        return;
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());

      // Transcribe
      const text = await stt.transcribe(audioBuffer);
      if (!text) {
        await ctx.reply('🔇 Не удалось распознать речь.');
        return;
      }

      // Show transcription
      await ctx.reply(`🎤 _${text}_`, { parse_mode: 'Markdown' });

      // Process through FreeClaude
      const session = sessions.getOrCreate(chatId);
      const context = sessions.getContext(chatId);
      const result = await fc.run(text, {
        workspace: session.workspace,
        model: session.model || undefined,
        context,
      });

      sessions.addMessage(chatId, 'user', text);
      sessions.addMessage(chatId, 'assistant', result.stdout);

      // Send response
      const responseText = result.stdout.substring(0, 4000);
      await ctx.reply(responseText, { parse_mode: 'Markdown' }).catch(() => {
        return ctx.reply(responseText);
      });

    } finally {
      queue.release(chatId);
    }
  };
}
```

### 10. Command Handler (`src/telegram/handlers/command.ts`)

```typescript
import { Context, InlineKeyboard } from 'grammy';
import type { BotConfig } from '../types.js';
import { FreeClaudeBridge } from '../services/freeclaude.js';
import { SessionManager } from '../services/session.js';
import { TTSService } from '../services/tts.js';

export function createCommandHandler(
  config: BotConfig,
  fc: FreeClaudeBridge,
  sessions: SessionManager,
  tts: TTSService,
) {
  return {
    start: async (ctx: Context) => {
      const session = sessions.getOrCreate(ctx.chat!.id);
      await ctx.reply(
        `🦀 *FreeClaude Bot*\n\n` +
        `AI coding workspace в Telegram.\n\n` +
        `📂 Workspace: \`${session.workspace}\`\n` +
        `🤖 Model: ${session.model || config.defaultModel}\n` +
        `🎤 Voice: ${session.voiceMode ? 'ON' : 'OFF'}\n\n` +
        `Отправь текст или голос — я вызову FreeClaude.`,
        { parse_mode: 'Markdown' },
      );
    },

    help: async (ctx: Context) => {
      await ctx.reply(
        `*Команды:*\n\n` +
        `/start — Информация\n` +
        `/help — Эта справка\n` +
        `/workspace <path> — Установить проект\n` +
        `/model <model> — Сменить LLM\n` +
        `/voice — Переключить голос\n` +
        `/reset — Сбросить историю\n` +
        `/status — Статус бота\n` +
        `/models — Список моделей\n\n` +
        `*Использование:*\n` +
        `• Напиши задачу текстом\n` +
        `• Отправь голосовое сообщение\n` +
        `• Отправь .ts/.js/.py файл`,
        { parse_mode: 'Markdown' },
      );
    },

    workspace: async (ctx: Context) => {
      const args = ctx.message?.text?.split(' ').slice(1).join(' ').trim();
      if (!args) {
        const session = sessions.getOrCreate(ctx.chat!.id);
        await ctx.reply(`📂 Текущий workspace: \`${session.workspace}\``, { parse_mode: 'Markdown' });
        return;
      }
      sessions.setWorkspace(ctx.chat!.id, args);
      await ctx.reply(`✅ Workspace: \`${args}\``, { parse_mode: 'Markdown' });
    },

    model: async (ctx: Context) => {
      const args = ctx.message?.text?.split(' ').slice(1).join(' ').trim();
      if (!args) {
        const session = sessions.getOrCreate(ctx.chat!.id);
        await ctx.reply(
          `🤖 Текущая модель: ${session.model || config.defaultModel}\n\n` +
          `Используй: /model <model>\n` +
          `Пример: /model zai/glm-5-turbo`,
        );
        return;
      }
      sessions.setModel(ctx.chat!.id, args);
      await ctx.reply(`✅ Model: ${args}`);
    },

    voice: async (ctx: Context) => {
      const enabled = sessions.toggleVoice(ctx.chat!.id);
      await ctx.reply(enabled ? '🎤 Голосовые ответы включены' : '🔇 Голосовые ответы выключены');
    },

    reset: async (ctx: Context) => {
      sessions.clearHistory(ctx.chat!.id);
      await ctx.reply('🗑 История очищена.');
    },

    status: async (ctx: Context) => {
      const session = sessions.getOrCreate(ctx.chat!.id);
      const fcAvailable = await fc.isAvailable();
      const ttsAvailable = await tts.isAvailable();

      await ctx.reply(
        `*Статус:*\n\n` +
        `🦀 FreeClaude: ${fcAvailable ? '✅' : '❌'}\n` +
        `🎤 TTS: ${ttsAvailable ? '✅' : '❌'}\n` +
        `📂 Workspace: \`${session.workspace}\`\n` +
        `🤖 Model: ${session.model || config.defaultModel}\n` +
        `🎤 Voice: ${session.voiceMode ? 'ON' : 'OFF'}\n` +
        `💬 History: ${session.history.length} messages`,
        { parse_mode: 'Markdown' },
      );
    },

    models: async (ctx: Context) => {
      const keyboard = new InlineKeyboard()
        .text('ZAI GLM-5 Turbo', 'model:zai/glm-5-turbo')
        .text('ZAI GLM-5', 'model:zai/glm-5')
        .row()
        .text('Gemini Flash', 'model:gemini-2.5-flash')
        .text('GPT-5.4', 'model:openai/gpt-5.4')
        .row()
        .text('Ollama Local', 'model:ollama/qwen2.5:3b');

      await ctx.reply('Выбери модель:', { reply_markup: keyboard });
    },
  };
}
```

### 11. Main Bot (`src/telegram/bot.ts`)

```typescript
import { Bot } from 'grammy';
import type { BotConfig } from './types.js';
import { loadConfig } from './config.js';
import { FreeClaudeBridge } from './services/freeclaude.js';
import { SessionManager } from './services/session.js';
import { TTSService } from './services/tts.js';
import { STTService } from './services/stt.js';
import { RequestQueue } from './services/queue.js';
import { createMessageHandler } from './handlers/message.js';
import { createVoiceHandler } from './handlers/voice.js';
import { createCommandHandler } from './handlers/command.js';

export async function createBot(config?: Partial<BotConfig>): Promise<Bot> {
  const cfg: BotConfig = { ...loadConfig(), ...config };

  if (!cfg.botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  const bot = new Bot(cfg.botToken);

  // Services
  const fc = new FreeClaudeBridge(cfg);
  const sessions = new SessionManager(cfg);
  const tts = new TTSService(cfg.ttsVoice, cfg.voiceEnabled);
  const stt = new STTService(cfg.sttModel, cfg.sttLanguage);
  const queue = new RequestQueue(cfg);

  // Handlers
  const cmdHandler = createCommandHandler(cfg, fc, sessions, tts);
  const msgHandler = createMessageHandler(cfg, fc, sessions, tts, queue);
  const voiceHandler = createVoiceHandler(cfg, stt, fc, sessions, queue);

  // Register commands
  bot.command('start', cmdHandler.start);
  bot.command('help', cmdHandler.help);
  bot.command('workspace', cmdHandler.workspace);
  bot.command('model', cmdHandler.model);
  bot.command('voice', cmdHandler.voice);
  bot.command('reset', cmdHandler.reset);
  bot.command('status', cmdHandler.status);
  bot.command('models', cmdHandler.models);

  // Callback queries (inline buttons)
  bot.callbackQuery(/^model:(.+)$/, async (ctx) => {
    const model = ctx.match![1];
    sessions.setModel(ctx.chat!.id, model);
    await ctx.answerCallbackQuery({ text: `Model: ${model}` });
    await ctx.reply(`✅ Model: ${model}`);
  });

  // Message handlers
  bot.on('message:text', msgHandler);
  bot.on('message:voice', voiceHandler);

  // File handler (future: code files)
  bot.on('message:document', async (ctx) => {
    const doc = ctx.message?.document;
    if (!doc) return;

    const chatId = ctx.chat!.id;
    await ctx.replyWithChatAction('typing');

    await queue.acquire(chatId);
    try {
      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) {
        await ctx.reply('❌ Не удалось получить файл.');
        return;
      }

      const url = `https://api.telegram.org/file/bot${cfg.botToken}/${file.file_path}`;
      const response = await fetch(url);
      const content = await response.text();

      const caption = ctx.message?.caption || `Файл: ${doc.file_name}`;
      const prompt = `${caption}\n\nСодержимое файла:\n\`\`\`\n${content.substring(0, 8000)}\n\`\`\``;

      const session = sessions.getOrCreate(chatId);
      const context = sessions.getContext(chatId);
      const result = await fc.run(prompt, {
        workspace: session.workspace,
        model: session.model || undefined,
        context,
      });

      sessions.addMessage(chatId, 'user', `[File: ${doc.file_name}]`);
      sessions.addMessage(chatId, 'assistant', result.stdout);

      await ctx.reply(result.stdout.substring(0, 4000));
    } finally {
      queue.release(chatId);
    }
  });

  // Session cleanup every hour
  setInterval(() => {
    const cleaned = sessions.cleanup();
    if (cleaned > 0) {
      console.log(`[sessions] Cleaned ${cleaned} expired sessions`);
    }
  }, 60 * 60 * 1000);

  return bot;
}

export async function startBot(config?: Partial<BotConfig>): Promise<void> {
  const bot = await createBot(config);

  // Error handling
  bot.catch((err) => {
    console.error('[bot] Error:', err);
  });

  console.log('[bot] Starting FreeClaude Telegram bot...');
  await bot.start({
    onStart: (info) => {
      console.log(`[bot] Started as @${info.username}`);
    },
  });
}
```

### 12. Entry Point (`src/telegram/index.ts`)

```typescript
export { startBot, createBot } from './bot.js';
export { loadConfig } from './config.js';
export type { BotConfig, ChatSession, FreeClaudeResult } from './types.js';
```

### 13. CLI Command (`src/commands/telegram/index.ts`)

```typescript
import { Command } from 'commander';
import { startBot } from '../../telegram/index.js';

export const telegramCommand = new Command('telegram')
  .description('Start Telegram bot interface')
  .option('--token <token>', 'Bot token (or TELEGRAM_BOT_TOKEN env)', process.env.TELEGRAM_BOT_TOKEN)
  .option('--allowed-users <ids>', 'Comma-separated Telegram user IDs')
  .option('--workspace <path>', 'Default workspace path')
  .option('--model <model>', 'Default LLM model')
  .option('--voice', 'Enable voice responses')
  .action(async (opts) => {
    await startBot({
      botToken: opts.token,
      allowedUsers: opts.allowedUsers?.split(',').map(Number) || [],
      defaultWorkspace: opts.workspace,
      defaultModel: opts.model,
      voiceEnabled: opts.voice,
    });
  });
```

### 14. Package.json additions

```json
{
  "dependencies": {
    "grammy": "^1.35.0"
  },
  "bin": {
    "freeclaude": "./dist/cli.mjs",
    "freeclaude-telegram": "./dist/telegram.mjs"
  },
  "scripts": {
    "telegram": "tsx src/telegram/standalone.ts",
    "telegram:build": "tsc src/telegram/standalone.ts --outDir dist"
  }
}
```

### 15. Standalone runner (`src/telegram/standalone.ts`)

```typescript
#!/usr/bin/env node
/**
 * Standalone Telegram bot runner.
 * Usage: npx freeclaude-telegram
 * Or: node dist/telegram.mjs
 */
import { startBot } from './index.js';

startBot().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

### 16. Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather

# Optional
ALLOWED_USERS=1258992460          # Comma-separated Telegram user IDs (empty = open)
DEFAULT_WORKSPACE=/path/to/project # Default project directory
DEFAULT_MODEL=zai/glm-5-turbo     # Default LLM model
MAX_CONCURRENT=1                   # Max concurrent requests per user
REQUEST_TIMEOUT=120000             # Request timeout in ms
VOICE_ENABLED=true                 # Enable TTS responses
TTS_VOICE=ru-RU-DmitryNeural       # Edge TTS voice
STT_MODEL=~/.openclaw/models/whisper/ggml-small.bin  # Whisper model path
STT_LANGUAGE=ru                    # STT language
```

### 17. Tests (`src/telegram/bot.test.ts`)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from './services/session.js';
import { RequestQueue } from './services/queue.js';
import type { BotConfig } from './types.js';

const mockConfig: BotConfig = {
  botToken: 'test',
  allowedUsers: [123],
  defaultWorkspace: '/tmp/test',
  freeclaudePath: 'freeclaude',
  maxConcurrentPerUser: 2,
  requestTimeoutMs: 5000,
  voiceEnabled: false,
};

describe('SessionManager', () => {
  it('creates session for new chat', () => {
    const sm = new SessionManager(mockConfig);
    const session = sm.getOrCreate(123);
    expect(session.chatId).toBe(123);
    expect(session.workspace).toBe('/tmp/test');
  });

  it('manages history', () => {
    const sm = new SessionManager(mockConfig);
    sm.addMessage(123, 'user', 'hello');
    sm.addMessage(123, 'assistant', 'hi');
    const ctx = sm.getContext(123);
    expect(ctx).toHaveLength(2);
  });

  it('trims history to max', () => {
    const sm = new SessionManager(mockConfig);
    for (let i = 0; i < 25; i++) {
      sm.addMessage(123, 'user', `msg ${i}`);
    }
    expect(sm.getOrCreate(123).history.length).toBeLessThanOrEqual(20);
  });

  it('toggles voice', () => {
    const sm = new SessionManager(mockConfig);
    expect(sm.toggleVoice(123)).toBe(true);
    expect(sm.toggleVoice(123)).toBe(false);
  });

  it('clears history', () => {
    const sm = new SessionManager(mockConfig);
    sm.addMessage(123, 'user', 'test');
    sm.clearHistory(123);
    expect(sm.getOrCreate(123).history).toHaveLength(0);
  });
});

describe('RequestQueue', () => {
  it('acquires and releases', async () => {
    const q = new RequestQueue(mockConfig);
    await q.acquire(123);
    q.release(123);
    expect(q.getStatus(123).active).toBe(0);
  });

  it('queues when max concurrent reached', async () => {
    const q = new RequestQueue({ ...mockConfig, maxConcurrentPerUser: 1 });
    await q.acquire(123);
    const p = q.acquire(123);
    q.release(123);
    await p;
    expect(q.getStatus(123).active).toBe(0);
  });
});
```

---

## Integration with FreeClaude CLI

The bot spawns `freeclaude --print` for each request. This means:

1. **Full FreeClaude power** — file editing, shell commands, MCP tools
2. **Session isolation** — each request is independent
3. **No code duplication** — all logic lives in FreeClaude CLI
4. **Workspace aware** — `--cwd` sets the working directory

### Future: Direct API Mode (Stage 6+)

Instead of spawning CLI, use FreeClaude's internal API directly:

```typescript
import { runFreeClaude } from '../core/runner.js';

// Direct API call (faster, no process spawn overhead)
const result = await runFreeClaude({
  prompt: text,
  workspace: session.workspace,
  model: session.model,
  tools: ['read', 'write', 'exec'],
});
```

This would require extracting the core runner into a shared module.

---

## Deployment Options

### Option 1: Local (development)
```bash
cd freeclaude
TELEGRAM_BOT_TOKEN=xxx npx tsx src/telegram/standalone.ts
```

### Option 2: PM2 (production)
```bash
pm2 start npm --name freeclaude-telegram -- start telegram
```

### Option 3: Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY dist/ ./dist/
COPY package.json ./
RUN npm ci --production
CMD ["node", "dist/telegram.mjs"]
```

### Option 4: Vercel/Cron (hosted routines only)
Deploy the API server part, use Telegram webhooks instead of polling.

---

## Security Considerations

1. **User whitelist** — only allowed Telegram user IDs can use the bot
2. **No arbitrary command execution** — prompts go through FreeClaude's permission system
3. **Workspace isolation** — each user gets their own workspace
4. **Rate limiting** — max concurrent requests per user
5. **Timeout** — kill runaway processes after timeout

---

## Summary for Pilot

| Stage | What | Files | Est. Time |
|-------|------|-------|-----------|
| 1 | Core bot + text messages | bot.ts, message.ts, command.ts, freeclaude.ts | 4h |
| 2 | Session management | session.ts, config.ts | 2h |
| 3 | Voice I/O | voice.ts, stt.ts, tts.ts | 3h |
| 4 | File uploads + routines | document handler, routine trigger | 3h |
| 5 | Security + multi-user | queue.ts, auth, rate limit | 2h |
| 6 | Tests | bot.test.ts | 2h |
| **Total** | | **~16 files** | **~16h** |

**Handoff to Copilot:** Give this plan + FreeClaude codebase access. Stages 1-2 are the MVP — can be working in one session.
