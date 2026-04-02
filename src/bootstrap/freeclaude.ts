#!/usr/bin/env node
/**
 * FreeClaude Bootstrap
 * Minimal changes for get Anthropic out of OAuth
 */

import { existsSync, from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distPath = join(__dirname, '..', 'dist', 'cli.mjs')

// Enable OpenAI mode
process.env.CLAUDE_CODE_USE_OPENAI = '1'

// Check for API key
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY not set')
  console.error('Set OPENAI_API_KEY environment variable')
  console.error('')
  console.error('Example:')
  console.error('  export OPENAI_API_KEY="your-key-here"')
  process.exit(1)
}

// Load and run CLI
if (existsSync(distPath)) {
  await import(pathToFileURL(distPath).href)
} else {
  console.error(`
  freeclaude: dist/cli.mjs not found.

  Build first:
    bun run build

  Or run directly:
    bun run dev
`)
  process.exit(1)
}
