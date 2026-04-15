import { InlineKeyboard } from 'grammy'
import type { Context } from 'grammy'
import type { BotConfig } from '../types.js'
import type { FreeClaudeBridge } from '../services/freeclaude.js'
import type { SessionManager } from '../services/session.js'
import type { TTSService } from '../services/tts.js'

export function createCommandHandler(
  config: BotConfig,
  fc: FreeClaudeBridge,
  sessions: SessionManager,
  tts: TTSService,
) {
  async function start(ctx: Context): Promise<void> {
    const session = sessions.getOrCreate(ctx.chat!.id)
    await ctx.reply(
        `🦀 *FreeClaude Bot*\n\n` +
          `AI coding workspace в Telegram.\n\n` +
          `📂 Workspace: \`${session.workspace}\`\n` +
          `📚 Read scope: \`${config.readRoots.join(', ')}\`\n` +
          `🤖 Model: ${session.model || config.defaultModel}\n` +
          `🎤 Voice: ${session.voiceMode ? 'ON' : 'OFF'}\n\n` +
          `Читать может в пределах read scope, править — только внутри workspace.`,
      { parse_mode: 'Markdown' },
    )
  }

  async function help(ctx: Context): Promise<void> {
    await ctx.reply(
      `*Команды:*\n\n` +
        `/start — Информация\n` +
        `/help — Эта справка\n` +
        `/workspace <path> — Установить проект\n` +
        `/model <model> — Сменить LLM\n` +
        `/voice — Переключить голосовые ответы\n` +
        `/reset — Сбросить историю\n` +
        `/status — Статус бота\n` +
        `/models — Список моделей\n\n` +
        `*Использование:*\n` +
          `• Напиши задачу текстом\n` +
          `• Отправь голосовое сообщение\n` +
          `• Отправь .ts/.js/.py файл\n\n` +
          `*Права:*\n` +
          `• Чтение: в пределах read scope\n` +
          `• Изменения: только внутри workspace`,
      { parse_mode: 'Markdown' },
    )
  }

  async function workspace(ctx: Context): Promise<void> {
    const args = ctx.message?.text?.split(' ').slice(1).join(' ').trim()
    if (!args) {
      const session = sessions.getOrCreate(ctx.chat!.id)
      await ctx.reply(
        `📂 Текущий workspace: \`${session.workspace}\``,
        { parse_mode: 'Markdown' },
      )
      return
    }
    sessions.setWorkspace(ctx.chat!.id, args)
    await ctx.reply(`✅ Workspace: \`${args}\``, { parse_mode: 'Markdown' })
  }

  async function model(ctx: Context): Promise<void> {
    const args = ctx.message?.text?.split(' ').slice(1).join(' ').trim()
    if (!args) {
      const session = sessions.getOrCreate(ctx.chat!.id)
      await ctx.reply(
        `🤖 Текущая модель: ${session.model || config.defaultModel}\n\n` +
          `Используй: /model <model>\n` +
          `Пример: /model zai/glm-5-turbo`,
      )
      return
    }
    sessions.setModel(ctx.chat!.id, args)
    await ctx.reply(`✅ Model: ${args}`)
  }

  async function voice(ctx: Context): Promise<void> {
    const enabled = sessions.toggleVoice(ctx.chat!.id)
    await ctx.reply(
      enabled ? '🎤 Голосовые ответы включены' : '🔇 Голосовые ответы выключены',
    )
  }

  async function reset(ctx: Context): Promise<void> {
    sessions.clearHistory(ctx.chat!.id)
    await ctx.reply('🗑 История очищена.')
  }

  async function status(ctx: Context): Promise<void> {
    const session = sessions.getOrCreate(ctx.chat!.id)
    const fcAvailable = await fc.isAvailable()
    const ttsAvailable = await tts.isAvailable()
    await ctx.reply(
        `*Статус:*\n\n` +
          `🦀 FreeClaude: ${fcAvailable ? '✅' : '❌'}\n` +
          `🎤 TTS: ${ttsAvailable ? '✅' : '❌'}\n` +
          `📂 Workspace: \`${session.workspace}\`\n` +
          `📚 Read scope: \`${config.readRoots.join(', ')}\`\n` +
          `🤖 Model: ${session.model || config.defaultModel}\n` +
          `🎙 Voice mode: ${session.voiceMode ? 'ON' : 'OFF'}\n` +
          `💬 History: ${session.history.length} messages`,
      { parse_mode: 'Markdown' },
    )
  }

  async function models(ctx: Context): Promise<void> {
    const keyboard = new InlineKeyboard()
      .text('ZAI GLM-5 Turbo', 'model:zai/glm-5-turbo')
      .text('ZAI GLM-5', 'model:zai/glm-5')
      .row()
      .text('Gemini 2.5 Flash', 'model:gemini-2.5-flash')
      .text('GPT-4o', 'model:openai/gpt-4o')
      .row()
      .text('Ollama Local', 'model:ollama/qwen2.5:3b')
    await ctx.reply('Выбери модель:', { reply_markup: keyboard })
  }

  return { start, help, workspace, model, voice, reset, status, models }
}
