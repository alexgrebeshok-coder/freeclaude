#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import {
  getFreeClaudeConfigPath,
  getOrderedConfiguredProviders,
  normalizeFreeClaudeConfig,
  readFreeClaudeConfig,
  writeFreeClaudeConfig,
} from '../utils/freeclaudeConfig.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distPath = join(__dirname, '..', 'dist', 'cli.mjs')

// ─── Load provider config ─────────────────────────────────────────────────

const configPath = getFreeClaudeConfigPath()
let hasProvider = false

if (existsSync(configPath)) {
  try {
    const rawConfig = readFreeClaudeConfig()
    const config = rawConfig ? normalizeFreeClaudeConfig(rawConfig) : null

    if (config?.changed) {
      writeFreeClaudeConfig(config.config)
    }

    const orderedProviders = config
      ? getOrderedConfiguredProviders(config.config)
      : []

    if (orderedProviders.length > 0) {
      for (const p of orderedProviders) {
        let apiKey = p.apiKey
        if (typeof apiKey === 'string' && apiKey.startsWith('env:')) {
          apiKey = process.env[apiKey.slice(4)] || ''
        }
        if (apiKey && apiKey !== '') {
          hasProvider = true
          // Set env vars that the bundled CLI expects
          process.env.CLAUDE_CODE_USE_OPENAI = '1'
          process.env.OPENAI_API_KEY = apiKey
          process.env.OPENAI_BASE_URL = p.baseUrl
          process.env.OPENAI_MODEL = p.model
          break
        }
      }
    }
  } catch {
    // Config parse error — fall through
  }
}

// If no config provider, try env vars
if (!hasProvider) {
  if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.ZAI_API_KEY) {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = process.env.ZAI_API_KEY || process.env.CODEX_API_KEY || ''
    }
    hasProvider = true
  }
}

// ─── Launch ───────────────────────────────────────────────────────────────

if (!hasProvider) {
  console.error(`
  ⚠ No API provider configured.

  Option 1 — Config file (~/.freeclaude.json):
    {
      "providers": [
        {
          "name": "zai",
          "baseUrl": "https://api.z.ai/api/coding/paas/v4",
          "apiKey": "env:ZAI_API_KEY",
          "model": "glm-4.7-flash",
          "priority": 1
        }
      ]
    }

  Option 2 — Environment variable:
    export OPENAI_API_KEY=sk-...

  Free providers: ZAI (free), Ollama (local)
`)
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
