import type { Context } from 'grammy'
import type { BotConfig } from '../types.js'
import type { STTService } from '../services/stt.js'
import {
  formatFreeClaudeResult,
  type FreeClaudeBridge,
} from '../services/freeclaude.js'
import type { SessionManager } from '../services/session.js'
import type { RequestQueue } from '../services/queue.js'

export function createVoiceHandler(
  config: BotConfig,
  stt: STTService,
  fc: FreeClaudeBridge,
  sessions: SessionManager,
  queue: RequestQueue,
) {
  return async (ctx: Context): Promise<void> => {
    const voice = ctx.message?.voice
    if (!voice) return

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

    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction('typing').catch(() => {})
    }, 4_000)

    try {
      const file = await ctx.api.getFile(voice.file_id)
      if (!file.file_path) {
        await ctx.reply('❌ Не удалось получить аудио.')
        return
      }

      const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`
      const response = await fetch(url)
      if (!response.ok) {
        await ctx.reply('❌ Ошибка загрузки аудио.')
        return
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer())
      const transcribed = await stt.transcribe(audioBuffer)
      if (!transcribed) {
        await ctx.reply('🔇 Не удалось распознать речь.')
        return
      }

      await ctx.reply(`🎤 _${transcribed}_`, { parse_mode: 'Markdown' })

      const session = sessions.getOrCreate(chatId)
      const context = sessions.getContext(chatId)

      const result = await fc.run(transcribed, {
        workspace: session.workspace,
        model: session.model || undefined,
        context,
      })

      sessions.addMessage(chatId, 'user', transcribed)
      sessions.addMessage(chatId, 'assistant', result.stdout)

      const responseText = formatFreeClaudeResult(result).slice(0, 4_000)
      await ctx.reply(responseText, { parse_mode: 'Markdown' }).catch(() =>
        ctx.reply(responseText),
      )
    } finally {
      clearInterval(typingInterval)
      queue.release(chatId)
    }
  }
}
