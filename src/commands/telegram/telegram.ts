import { startBot } from '../../telegram/index.js'

type TextResult = { type: 'text'; value: string }

const HELP_TEXT =
  '❌ TELEGRAM_BOT_TOKEN is not set.\n\n' +
  'Set it before starting FreeClaude:\n' +
  '  export TELEGRAM_BOT_TOKEN=your_token_from_botfather\n\n' +
  'Or use the standalone runner:\n' +
  '  TELEGRAM_BOT_TOKEN=xxx node dist/telegram.mjs'

export async function call(args: string): Promise<TextResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return { type: 'text', value: HELP_TEXT }
  }

  const allowedUsersArg = args.trim()
  const allowedUsers = allowedUsersArg
    ? allowedUsersArg
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n))
    : undefined

  console.log('[telegram] Starting bot... (Ctrl+C to stop)')
  await startBot({ allowedUsers })
  return { type: 'text', value: '[telegram] Bot stopped.' }
}
