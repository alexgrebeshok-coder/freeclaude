export interface BotConfig {
  botToken: string
  allowedUsers: number[]
  defaultWorkspace: string
  readRoots: string[]
  freeclaudePath: string
  defaultModel: string
  maxConcurrentPerUser: number
  requestTimeoutMs: number
  voiceEnabled: boolean
  ttsVoice: string
  sttModel: string
  sttLanguage: string
}

export interface ChatSession {
  chatId: number
  workspace: string
  model: string
  voiceMode: boolean
  history: MessageRecord[]
  lastActivity: number
}

export interface MessageRecord {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface FreeClaudeResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}
