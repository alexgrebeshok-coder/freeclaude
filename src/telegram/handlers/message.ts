import { InputFile } from 'grammy'
import type { Context } from 'grammy'
import type { BotConfig } from '../types.js'
import {
  formatFreeClaudeResult,
  type FreeClaudeBridge,
} from '../services/freeclaude.js'
import type { SessionManager } from '../services/session.js'
import type { TTSService } from '../services/tts.js'
import type { RequestQueue } from '../services/queue.js'

/** Split long text into chunks at newline boundaries for Telegram (max 4096 chars). */
function splitMessage(text: string, maxLen = 4_000): string[] {
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }
    const splitIdx = remaining.lastIndexOf('\n', maxLen)
    if (splitIdx > 0) {
      chunks.push(remaining.slice(0, splitIdx))
      remaining = remaining.slice(splitIdx + 1)
    } else {
      chunks.push(remaining.slice(0, maxLen))
      remaining = remaining.slice(maxLen)
    }
  }
  return chunks
}

export function createMessageHandler(
  config: BotConfig,
  fc: FreeClaudeBridge,
  sessions: SessionManager,
  tts: TTSService,
  queue: RequestQueue,
) {
  return async (ctx: Context): Promise<void> => {
    const text = ctx.message?.text
    if (!text || text.startsWith('/')) return

    const chatId = ctx.chat?.id
    if (chatId === undefined) return

    const userId = ctx.from?.id
    if (
      userId !== undefined &&
      config.allowedUsers.length > 0 &&
      !config.allowedUsers.includes(userId)
    ) {
      await ctx.reply('⛔ Доступ запрещён.')
      return
    }

    await ctx.replyWithChatAction('typing')
    await queue.acquire(chatId)

    // Refresh "typing..." every 4s (Telegram expires it after ~5s)
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction('typing').catch(() => {})
    }, 4_000)

    try {
      const session = sessions.getOrCreate(chatId)
      const context = sessions.getContext(chatId)

      const result = await fc.run(text, {
        workspace: session.workspace,
        model: session.model || undefined,
        context,
      })

      sessions.addMessage(chatId, 'user', text)
      sessions.addMessage(chatId, 'assistant', result.stdout)

      const responseText = formatFreeClaudeResult(result)

      const chunks = splitMessage(responseText)
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(() =>
          ctx.reply(chunk),
        )
      }

      if (session.voiceMode && result.stdout) {
        const audio = await tts.synthesize(result.stdout.slice(0, 400))
        if (audio) {
          await ctx.replyWithVoice(new InputFile(audio, 'response.ogg'))
        }
      }
    } finally {
      clearInterval(typingInterval)
      queue.release(chatId)
    }
  }
}
