import { Bot } from 'grammy'
import type { BotConfig } from './types.js'
import { loadConfig } from './config.js'
import {
  formatFreeClaudeResult,
  FreeClaudeBridge,
} from './services/freeclaude.js'
import { SessionManager } from './services/session.js'
import { TTSService } from './services/tts.js'
import { STTService } from './services/stt.js'
import { RequestQueue } from './services/queue.js'
import { createMessageHandler } from './handlers/message.js'
import { createVoiceHandler } from './handlers/voice.js'
import { createCommandHandler } from './handlers/command.js'

export async function createBot(config?: Partial<BotConfig>): Promise<Bot> {
  const cfg: BotConfig = { ...loadConfig(), ...config }

  if (!cfg.botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required')
  }

  const bot = new Bot(cfg.botToken)

  const fc = new FreeClaudeBridge(cfg)
  const sessions = new SessionManager(cfg)
  const tts = new TTSService(cfg.ttsVoice, cfg.voiceEnabled)
  const stt = new STTService(cfg.sttModel, cfg.sttLanguage)
  const queue = new RequestQueue(cfg)

  const cmdHandler = createCommandHandler(cfg, fc, sessions, tts)
  const msgHandler = createMessageHandler(cfg, fc, sessions, tts, queue)
  const voiceHandler = createVoiceHandler(cfg, stt, fc, sessions, queue)

  bot.command('start', cmdHandler.start)
  bot.command('help', cmdHandler.help)
  bot.command('workspace', cmdHandler.workspace)
  bot.command('model', cmdHandler.model)
  bot.command('voice', cmdHandler.voice)
  bot.command('reset', cmdHandler.reset)
  bot.command('status', cmdHandler.status)
  bot.command('models', cmdHandler.models)

  // Inline keyboard: model selection
  bot.callbackQuery(/^model:(.+)$/, async ctx => {
    const model = ctx.match![1]!
    sessions.setModel(ctx.chat!.id, model)
    await ctx.answerCallbackQuery({ text: `Model: ${model}` })
    await ctx.reply(`✅ Model: ${model}`)
  })

  bot.on('message:text', msgHandler)
  bot.on('message:voice', voiceHandler)

  // File upload handler (code files)
  bot.on('message:document', async ctx => {
    const doc = ctx.message?.document
    if (!doc) return

    const chatId = ctx.chat!.id
    const userId = ctx.from?.id
    if (
      userId !== undefined &&
      cfg.allowedUsers.length > 0 &&
      !cfg.allowedUsers.includes(userId)
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
      const file = await ctx.api.getFile(doc.file_id)
      if (!file.file_path) {
        await ctx.reply('❌ Не удалось получить файл.')
        return
      }

      const url = `https://api.telegram.org/file/bot${cfg.botToken}/${file.file_path}`
      const response = await fetch(url)
      if (!response.ok) {
        await ctx.reply('❌ Ошибка загрузки файла.')
        return
      }
      const content = await response.text()
      const caption = ctx.message?.caption ?? `Файл: ${doc.file_name}`
      const prompt = `${caption}\n\nСодержимое файла:\n\`\`\`\n${content.slice(0, 8_000)}\n\`\`\``

      const session = sessions.getOrCreate(chatId)
      const context = sessions.getContext(chatId)
      const result = await fc.run(prompt, {
        workspace: session.workspace,
        model: session.model || undefined,
        context,
      })

      sessions.addMessage(chatId, 'user', `[File: ${doc.file_name}]`)
      sessions.addMessage(chatId, 'assistant', result.stdout)

      const text = formatFreeClaudeResult(result).slice(0, 4_000)
      await ctx.reply(text, { parse_mode: 'Markdown' }).catch(() =>
        ctx.reply(text),
      )
    } finally {
      clearInterval(typingInterval)
      queue.release(chatId)
    }
  })

  bot.catch(err => {
    console.error('[bot] error:', err)
  })

  // Periodically clean up expired sessions
  setInterval(
    () => {
      const cleaned = sessions.cleanup()
      if (cleaned > 0) {
        console.log(`[sessions] cleaned ${cleaned} expired sessions`)
      }
    },
    60 * 60 * 1_000,
  )

  return bot
}

export async function startBot(config?: Partial<BotConfig>): Promise<void> {
  const bot = await createBot(config)
  console.log('[bot] Starting FreeClaude Telegram bot...')
  await bot.start({
    onStart: info => {
      console.log(`[bot] Started as @${info.username}`)
    },
  })
}
