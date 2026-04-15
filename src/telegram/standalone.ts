#!/usr/bin/env node
/**
 * Standalone Telegram bot runner.
 * Usage: npx freeclaude-telegram
 *   or:  TELEGRAM_BOT_TOKEN=xxx node dist/telegram.mjs
 */
import { startBot } from './index.js'

startBot().catch(err => {
  console.error('[bot] Fatal error:', err)
  process.exit(1)
})
