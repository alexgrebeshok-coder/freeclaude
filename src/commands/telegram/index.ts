import type { Command } from '../../commands.js'

const telegram = {
  type: 'local',
  name: 'telegram',
  description:
    'Start the FreeClaude Telegram bot (requires TELEGRAM_BOT_TOKEN env var). Usage: /telegram [allowed_user_ids]',
  supportsNonInteractive: false,
  load: () => import('./telegram.js'),
} satisfies Command

export default telegram
