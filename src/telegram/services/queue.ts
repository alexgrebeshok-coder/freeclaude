import type { BotConfig } from '../types.js'

interface PendingRequest {
  resolve: () => void
}

export class RequestQueue {
  private active = new Map<number, number>()
  private waiting = new Map<number, PendingRequest[]>()

  constructor(private config: BotConfig) {}

  /**
   * Acquire a processing slot for the given chat.
   * Waits if the user is already at maxConcurrentPerUser.
   */
  async acquire(chatId: number): Promise<void> {
    const current = this.active.get(chatId) ?? 0
    if (current < this.config.maxConcurrentPerUser) {
      this.active.set(chatId, current + 1)
      return
    }

    return new Promise<void>(resolve => {
      const queue = this.waiting.get(chatId) ?? []
      queue.push({ resolve })
      this.waiting.set(chatId, queue)
    })
  }

  release(chatId: number): void {
    const current = this.active.get(chatId) ?? 0
    if (current > 0) {
      this.active.set(chatId, current - 1)
    }

    const queue = this.waiting.get(chatId)
    if (queue && queue.length > 0) {
      const next = queue.shift()!
      this.active.set(chatId, (this.active.get(chatId) ?? 0) + 1)
      next.resolve()
      if (queue.length === 0) {
        this.waiting.delete(chatId)
      }
    }
  }

  getStatus(chatId: number): { active: number; waiting: number } {
    return {
      active: this.active.get(chatId) ?? 0,
      waiting: (this.waiting.get(chatId) ?? []).length,
    }
  }
}
