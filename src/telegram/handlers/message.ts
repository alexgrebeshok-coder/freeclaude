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

/**
 * Split long text into Telegram-safe chunks, preserving code blocks.
 * Tries to split at: code block boundaries → paragraph breaks → newlines.
 */
function splitMessage(text: string, maxLen = 4_000): string[] {
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }

    let splitIdx = -1

    // 1. Try to split at a code block boundary (``` on its own line)
    const codeBlockEnd = remaining.lastIndexOf('\n```\n', maxLen)
    if (codeBlockEnd > maxLen * 0.3) {
      splitIdx = codeBlockEnd + 4 // after the closing ```\n
    }

    // 2. Try paragraph break (double newline)
    if (splitIdx < 0) {
      const paraBreak = remaining.lastIndexOf('\n\n', maxLen)
      if (paraBreak > maxLen * 0.3) {
        splitIdx = paraBreak + 1
      }
    }

    // 3. Try single newline
    if (splitIdx < 0) {
      const newline = remaining.lastIndexOf('\n', maxLen)
      if (newline > 0) {
        splitIdx = newline + 1
      }
    }

    // 4. Hard cut as last resort
    if (splitIdx <= 0) {
      splitIdx = maxLen
    }

    chunks.push(remaining.slice(0, splitIdx))
    remaining = remaining.slice(splitIdx)
  }
  return chunks
}

/** Format a user-friendly error message for Telegram. */
function formatTelegramError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message
    if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
      return '🔌 Не удалось подключиться к API. Проверьте конфигурацию провайдера.'
    }
    if (msg.includes('All providers failed') || msg.includes('All providers exhausted')) {
      return '❌ Все провайдеры недоступны. Проверьте API-ключи и подключение.'
    }
    if (msg.includes('rate limit') || msg.includes('429')) {
      return '⏳ Превышен лимит запросов. Попробуйте через минуту.'
    }
    if (msg.includes('timeout') || msg.includes('SIGKILL')) {
      return '⏱ Запрос занял слишком много времени и был прерван. Попробуйте более короткий запрос.'
    }
    return `⚠️ Ошибка: ${msg.slice(0, 300)}`
  }
  return '⚠️ Произошла неизвестная ошибка. Попробуйте ещё раз.'
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

    // Send a progress indicator that we'll edit later
    let progressMsg: Awaited<ReturnType<typeof ctx.reply>> | null = null
    const progressTimeout = setTimeout(async () => {
      try {
        progressMsg = await ctx.reply('⏳ Обрабатываю запрос…')
      } catch { /* ignore */ }
    }, 3_000) // Show progress only if request takes > 3s

    try {
      const session = sessions.getOrCreate(chatId)
      const context = sessions.getContext(chatId)

      const result = await fc.run(text, {
        workspace: session.workspace,
        model: session.model || undefined,
        context,
      })

      clearTimeout(progressTimeout)

      // Delete progress message if it was sent
      if (progressMsg) {
        try { await ctx.api.deleteMessage(chatId, progressMsg.message_id) } catch { /* ignore */ }
      }

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
    } catch (error) {
      clearTimeout(progressTimeout)
      if (progressMsg) {
        try { await ctx.api.deleteMessage(chatId, progressMsg.message_id) } catch { /* ignore */ }
      }
      await ctx.reply(formatTelegramError(error))
    } finally {
      clearInterval(typingInterval)
      queue.release(chatId)
    }
  }
}
