#!/usr/bin/env node

import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distPath = join(__dirname, '..', 'dist', 'cli.mjs')

process.env.CLAUDE_CODE_USE_OPENAI = '1'

if (!process.env.OPENAI_API_KEY && !process.env.CODEX_API_KEY) {
  console.error('OPENAI_API_KEY or CODEX_API_KEY must be set.')
  process.exit(1)
}

if (existsSync(distPath)) {
  await import(pathToFileURL(distPath).href)
} else {
  console.error(`
freeclaude: dist/cli.mjs not found.

Build first:
  bun run build
`)
  process.exit(1)
}
