import type { BotConfig, ChatSession, MessageRecord } from '../types.js'

const MAX_HISTORY = 20
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

export class SessionManager {
  private sessions = new Map<number, ChatSession>()

  constructor(private config: BotConfig) {}

  getOrCreate(chatId: number): ChatSession {
    let session = this.sessions.get(chatId)
    if (!session) {
      session = {
        chatId,
        workspace: this.config.defaultWorkspace,
        model: this.config.defaultModel,
        voiceMode: false,
        history: [],
        lastActivity: Date.now(),
      }
      this.sessions.set(chatId, session)
    }
    return session
  }

  addMessage(chatId: number, role: 'user' | 'assistant', content: string): void {
    const session = this.getOrCreate(chatId)
    const record: MessageRecord = { role, content, timestamp: Date.now() }
    session.history.push(record)
    if (session.history.length > MAX_HISTORY) {
      session.history = session.history.slice(-MAX_HISTORY)
    }
    session.lastActivity = Date.now()
  }

  getContext(chatId: number): string[] {
    const session = this.sessions.get(chatId)
    if (!session) return []
    return session.history.map(m => `${m.role}: ${m.content}`)
  }

  setWorkspace(chatId: number, path: string): void {
    this.getOrCreate(chatId).workspace = path
  }

  setModel(chatId: number, model: string): void {
    this.getOrCreate(chatId).model = model
  }

  toggleVoice(chatId: number): boolean {
    const session = this.getOrCreate(chatId)
    session.voiceMode = !session.voiceMode
    return session.voiceMode
  }

  clearHistory(chatId: number): void {
    const session = this.getOrCreate(chatId)
    session.history = []
    session.lastActivity = Date.now()
  }

  /** Remove sessions inactive for more than SESSION_TTL_MS. */
  cleanup(): number {
    const now = Date.now()
    let removed = 0
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        this.sessions.delete(id)
        removed++
      }
    }
    return removed
  }
}
