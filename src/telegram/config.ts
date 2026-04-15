import type { BotConfig } from './types.js'
import { homedir } from 'node:os'

function parseAllowedUsers(env: string): number[] {
  if (!env) return []
  return env
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n))
}

function parsePaths(env: string): string[] {
  if (!env.trim()) return []
  return env
    .split(',')
    .map(path => path.trim())
    .filter(Boolean)
}

export function loadConfig(): BotConfig {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    allowedUsers: parseAllowedUsers(process.env.ALLOWED_USERS ?? ''),
    defaultWorkspace: process.env.DEFAULT_WORKSPACE ?? process.cwd(),
    readRoots: parsePaths(process.env.READ_ROOTS ?? '').concat(homedir()),
    freeclaudePath: process.env.FREECLAUDE_PATH ?? 'freeclaude',
    defaultModel: process.env.DEFAULT_MODEL ?? 'zai/glm-5-turbo',
    maxConcurrentPerUser: parseInt(process.env.MAX_CONCURRENT ?? '1', 10),
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT ?? '120000', 10),
    voiceEnabled: process.env.VOICE_ENABLED !== 'false',
    ttsVoice: process.env.TTS_VOICE ?? 'ru-RU-DmitryNeural',
    sttModel:
      process.env.STT_MODEL ??
      '~/.openclaw/models/whisper/ggml-small.bin',
    sttLanguage: process.env.STT_LANGUAGE ?? 'ru',
  }
}
