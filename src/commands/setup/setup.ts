/**
 * FreeClaude v3 — /setup Command (in-REPL provider management)
 *
 * Add, remove, and manage providers directly inside FreeClaude.
 *
 * Usage:
 *   /setup                — show categories and provider list
 *   /setup free           — show free providers
 *   /setup local          — show local providers
 *   /setup add <N> [key]  — add provider #N (auto-detect key from env if omitted)
 *   /setup remove <N>     — remove provider #N
 *   /setup qwen <key>     — quick-add Qwen/DashScope
 *   /setup zai [key]      — quick-add ZAI
 *   /setup ollama         — quick-add Ollama (local)
 *   /setup openrouter <key> — quick-add OpenRouter
 */

import type { LocalCommandCall } from '../../types/command.js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_PATH = join(homedir(), '.freeclaude.json')

interface Provider {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  priority?: number
  timeout?: number
}

interface Config {
  providers?: Provider[]
  activeProvider?: string
  activeModel?: string
}

// ─── Provider Registry (subset — most popular) ────────────────────────────

const PROVIDERS = [
  // Free
  { name: 'ZAI (free — GLM-5)', slug: 'zai', baseUrl: 'https://api.z.ai/api/coding/paas/v4', models: ['glm-5', 'glm-4.7-flash', 'glm-4.7'], envKey: 'ZAI_API_KEY', desc: '🇨🇳 Free Chinese LLM — GLM-5 frontier model', tags: ['free', 'frontier', 'code'] },
  { name: 'Google Gemini (free tier)', slug: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-flash', 'gemini-2.5-pro'], envKey: 'GEMINI_API_KEY', desc: '🇺🇸 Google multimodal AI — free tier (15 RPM)', tags: ['free', 'frontier'] },
  { name: 'Groq (free tier)', slug: 'groq', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-4-scout-17b-16e-instruct', 'qwen-qwq-32b'], envKey: 'GROQ_API_KEY', desc: '⚡ Ultra-fast inference — free tier', tags: ['free', 'fast'] },
  { name: 'Cerebras (free tier)', slug: 'cerebras', baseUrl: 'https://api.cerebras.ai/v1', models: ['llama-4-scout-17b-16e', 'llama3.1-8b', 'qwen-2.5-32b'], envKey: 'CEREBRAS_API_KEY', desc: '🚀 ~3000 tok/s — free tier', tags: ['free', 'fastest'] },
  { name: 'SiliconFlow (free tier)', slug: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-8B'], envKey: 'SILICONFLOW_API_KEY', desc: '🇨🇳 Chinese inference — many free models', tags: ['free', 'chinese'] },
  { name: 'Qwen / DashScope (free tier)', slug: 'qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen3-235b-a22b', 'qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-coder-plus'], envKey: 'DASHSCOPE_API_KEY', desc: '🇨🇳 Qwen by Alibaba — free tier, strong code', tags: ['free', 'chinese', 'code'] },
  { name: 'SambaNova (free tier)', slug: 'sambanova', baseUrl: 'https://api.sambanova.ai/v1', models: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-R1-Distill-Llama-70B'], envKey: 'SAMBANOVA_API_KEY', desc: '⚡ Fast inference — free tier', tags: ['free', 'fast'] },
  // Local
  { name: 'Ollama (local)', slug: 'ollama', baseUrl: 'http://localhost:11434/v1', models: ['qwen2.5:3b', 'qwen2.5:7b', 'llama3.2', 'deepseek-r1:8b'], envKey: '', desc: '🏠 Run locally — free, private', tags: ['local', 'free'], defaultKey: 'ollama' },
  { name: 'LM Studio (local)', slug: 'lmstudio', baseUrl: 'http://localhost:1234/v1', models: ['(auto-detected)'], envKey: '', desc: '🏠 GUI model runner', tags: ['local', 'free'], defaultKey: 'lm-studio' },
  // Paid
  { name: 'OpenAI', slug: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'], envKey: 'OPENAI_API_KEY', desc: '🏢 GPT series — industry standard', tags: ['paid', 'frontier'] },
  { name: 'DeepSeek', slug: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'], envKey: 'DEEPSEEK_API_KEY', desc: '🇨🇳 DeepSeek V3/R1 — excellent code, very cheap', tags: ['paid', 'code', 'cheap'] },
  { name: 'Mistral AI', slug: 'mistral', baseUrl: 'https://api.mistral.ai/v1', models: ['mistral-large-latest', 'codestral-latest'], envKey: 'MISTRAL_API_KEY', desc: '🇫🇷 Mistral & Codestral — European AI', tags: ['paid', 'code', 'european'] },
  // Routers
  { name: 'OpenRouter (200+ models)', slug: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['anthropic/claude-sonnet-4', 'google/gemini-2.5-flash', 'openai/gpt-4o', 'deepseek/deepseek-chat'], envKey: 'OPENROUTER_API_KEY', desc: '🔀 One API for 200+ models', tags: ['router', 'multi-model'] },
  { name: 'Together AI', slug: 'together', baseUrl: 'https://api.together.xyz/v1', models: ['meta-llama/Llama-4-Maverick-17B-128E-Instruct', 'Qwen/Qwen3-235B-A22B'], envKey: 'TOGETHER_API_KEY', desc: '🤝 200+ OSS models — $25 free credit', tags: ['router', 'oss'] },
  { name: 'Fireworks AI', slug: 'fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', models: ['accounts/fireworks/models/llama-v4p-70b-instruct'], envKey: 'FIREWORKS_API_KEY', desc: '🧨 Fast inference + fine-tuning', tags: ['router', 'fast'] },
  { name: 'DeepInfra', slug: 'deepinfra', baseUrl: 'https://api.deepinfra.com/v1/openai', models: ['meta-llama/Llama-4-Maverick-17B-128E-Instruct', 'Qwen/Qwen3-235B-A22B'], envKey: 'DEEPINFRA_API_KEY', desc: '🇺🇦 Cheapest inference — widest catalog', tags: ['router', 'cheap'] },
  // Special
  { name: 'Perplexity (search AI)', slug: 'perplexity', baseUrl: 'https://api.perplexity.ai', models: ['sonar-pro', 'sonar-reasoning'], envKey: 'PERPLEXITY_API_KEY', desc: '🔍 AI with web search', tags: ['special', 'search'] },
  { name: 'HuggingFace', slug: 'huggingface', baseUrl: 'https://api-inference.huggingface.co/v1', models: ['(any HF model ID)'], envKey: 'HF_TOKEN', desc: '🤗 500K+ models — free tier', tags: ['special', 'oss'] },
  // Custom
  { name: 'Custom (any OpenAI-compatible)', slug: 'custom', baseUrl: '', models: [], envKey: '', desc: '🔧 Any /v1/chat/completions endpoint', tags: ['custom'] },
]

function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return { providers: [] }
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Config }
  catch { return { providers: [] } }
}

function saveConfig(config: Config): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return '••••'
  if (key.startsWith('env:')) return `env:••••`
  return key.slice(0, 4) + '••••' + key.slice(-4)
}

export const call: LocalCommandCall = async (args) => {
  const parts = args.trim().split(/\s+/)
  const cmd = parts[0] || ''
  const rest = parts.slice(1)

  // Quick-add shortcuts
  if (cmd === 'zai') return quickAdd('zai', rest[0])
  if (cmd === 'qwen' || cmd === 'dashscope') return quickAdd('qwen', rest[0])
  if (cmd === 'ollama') return quickAdd('ollama')
  if (cmd === 'groq') return quickAdd('groq', rest[0])
  if (cmd === 'openrouter' || cmd === 'or') return quickAdd('openrouter', rest[0])
  if (cmd === 'openai') return quickAdd('openai', rest[0])
  if (cmd === 'deepseek') return quickAdd('deepseek', rest[0])
  if (cmd === 'gemini') return quickAdd('gemini', rest[0])
  if (cmd === 'mistral') return quickAdd('mistral', rest[0])
  if (cmd === 'cerebras') return quickAdd('cerebras', rest[0])
  if (cmd === 'sambanova') return quickAdd('sambanova', rest[0])
  if (cmd === 'siliconflow') return quickAdd('siliconflow', rest[0])
  if (cmd === 'together') return quickAdd('together', rest[0])
  if (cmd === 'fireworks') return quickAdd('fireworks', rest[0])
  if (cmd === 'deepinfra') return quickAdd('deepinfra', rest[0])
  if (cmd === 'perplexity') return quickAdd('perplexity', rest[0])
  if (cmd === 'huggingface' || cmd === 'hf') return quickAdd('huggingface', rest[0])

  // /setup remove <N>
  if (cmd === 'remove' || cmd === 'rm' || cmd === 'del') {
    return removeProvider(parseInt(rest[0]) - 1)
  }

  // /setup add <N> [key] [model]
  if (cmd === 'add') {
    const idx = parseInt(rest[0]) - 1
    const key = rest[1] || ''
    const model = rest[2] || ''
    return addProvider(idx, key, model)
  }

  // /setup free / local / paid / router / special
  if (['free', 'local', 'paid', 'router', 'special', 'enterprise', 'all'].includes(cmd)) {
    return showList(cmd)
  }

  // /setup — main menu
  return showMainMenu()
}

function showMainMenu(): { type: 'text'; value: string } {
  const config = loadConfig()
  const current = config.activeProvider || config.activeModel || 'none'

  return {
    type: 'text' as const,
    value: [
      '🦀 FreeClaude Provider Setup',
      '',
      `  Active: ${current}`,
      `  Configured: ${(config.providers ?? []).length} provider(s)`,
      '',
      '  ── Quick add ──────────────────────────────────',
      '  /setup zai              ZAI (free, GLM-5)',
      '  /setup qwen <key>       Qwen/DashScope (free)',
      '  /setup ollama           Ollama (local)',
      '  /setup groq <key>       Groq (free tier)',
      '  /setup openrouter <key> OpenRouter (200+ models)',
      '  /setup openai <key>     OpenAI (GPT-4o)',
      '  /setup deepseek <key>   DeepSeek (V3/R1)',
      '  /setup gemini <key>     Google Gemini (free)',
      '  /setup cerebras <key>   Cerebras (3000 tok/s)',
      '  /setup mistral <key>    Mistral AI',
      '',
      '  ── Browse & add ──────────────────────────────',
      '  /setup free             Free providers',
      '  /setup local            Local (Ollama, LM Studio)',
      '  /setup paid             Paid (OpenAI, DeepSeek...)',
      '  /setup router           Routers (OpenRouter, Together...)',
      '  /setup all              All 19 providers',
      '',
      '  ── Manage ────────────────────────────────────',
      '  /setup add <N> [key]    Add provider by number',
      '  /setup remove <N>       Remove provider',
      '  /model                  Switch active model',
      '  /providers test         Test connectivity',
      '',
      '  ── Keys auto-detected from env vars ──────────',
      '  ZAI_API_KEY, DASHSCOPE_API_KEY, GROQ_API_KEY,',
      '  OPENROUTER_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY,',
      '  GEMINI_API_KEY, MISTRAL_API_KEY, HF_TOKEN, ...',
    ].join('\n'),
  }
}

function showList(category: string): { type: 'text'; value: string } {
  let filtered = PROVIDERS

  switch (category) {
    case 'free': filtered = PROVIDERS.filter(p => p.tags.includes('free')); break
    case 'local': filtered = PROVIDERS.filter(p => p.tags.includes('local')); break
    case 'paid': filtered = PROVIDERS.filter(p => p.tags.includes('paid')); break
    case 'router': filtered = PROVIDERS.filter(p => p.tags.includes('router')); break
    case 'special': filtered = PROVIDERS.filter(p => p.tags.includes('special')); break
    case 'enterprise': filtered = PROVIDERS.filter(p => p.tags.includes('enterprise')); break
  }

  const lines = [`📡 ${category.charAt(0).toUpperCase() + category.slice(1)} providers:`, '']

  // Get global index
  for (let i = 0; i < filtered.length; i++) {
    const p = filtered[i]!
    const globalIdx = PROVIDERS.indexOf(p) + 1
    const tags = p.tags.map(t => `[${t}]`).join(' ')
    lines.push(`  ${globalIdx}) ${p.name}`)
    lines.push(`     ${p.desc} ${tags}`)
    lines.push(`     Models: ${p.models.slice(0, 3).join(', ')}${p.models.length > 3 ? '...' : ''}`)
    lines.push(`     Add: /setup add ${globalIdx} [api-key]`)
    lines.push('')
  }

  lines.push('  Usage: /setup add <N> [api-key]')
  lines.push('  If no key provided, will auto-detect from environment.')

  return { type: 'text' as const, value: lines.join('\n') }
}

function quickAdd(slug: string, apiKeyArg?: string): { type: 'text'; value: string } {
  const def = PROVIDERS.find(p => p.slug === slug)
  if (!def) return { type: 'text' as const, value: `❌ Unknown provider: ${slug}` }

  const config = loadConfig()
  config.providers = config.providers ?? []

  // Check duplicate
  const existing = config.providers.find(p => p.name === def.slug)
  if (existing) {
    return { type: 'text' as const, value: `ℹ️  ${def.name} already configured. Use /model to switch.` }
  }

  let apiKey = ''
  let model = def.models[0] || ''

  // Resolve API key
  if (def.defaultKey) {
    apiKey = def.defaultKey
  } else if (apiKeyArg) {
    apiKey = apiKeyArg
  } else if (def.envKey && process.env[def.envKey]) {
    apiKey = `env:${def.envKey}`
  } else if (def.envKey) {
    return {
      type: 'text' as const,
      value: [
        `🔑 ${def.name} needs an API key.`,
        '',
        `  Option 1: Set env var first:`,
        `    export ${def.envKey}=your-key`,
        `    Then run: /setup ${slug}`,
        '',
        `  Option 2: Pass key directly:`,
        `    /setup ${slug} your-api-key-here`,
        '',
        `  Get key: See provider documentation`,
      ].join('\n'),
    }
  }

  // Add to config
  config.providers.push({
    name: def.slug,
    baseUrl: def.baseUrl.replace(/\/$/, ''),
    apiKey,
    model,
    priority: config.providers.length + 1,
    timeout: def.tags.includes('local') ? 120000 : 30000,
  })

  saveConfig(config)

  const keyDisplay = apiKey.startsWith('env:') ? `env:${def.envKey}` : maskKey(apiKey)

  return {
    type: 'text' as const,
    value: [
      `✅ ${def.name} added!`,
      `   Model: ${model}`,
      `   Key: ${keyDisplay}`,
      '',
      `   Run /model to switch, or /providers test to verify.`,
    ].join('\n'),
  }
}

function addProvider(idx: number, apiKeyArg: string, modelArg: string): { type: 'text'; value: string } {
  if (isNaN(idx) || idx < 0 || idx >= PROVIDERS.length) {
    return { type: 'text' as const, value: `❌ Invalid provider number. Run /setup all to see options.` }
  }

  const def = PROVIDERS[idx]!
  const config = loadConfig()
  config.providers = config.providers ?? []

  const existing = config.providers.find(p => p.name === def.slug)
  if (existing) {
    return { type: 'text' as const, value: `ℹ️  ${def.name} already configured.` }
  }

  let apiKey = ''
  let model = modelArg || def.models[0] || ''

  if (def.defaultKey) {
    apiKey = def.defaultKey
  } else if (apiKeyArg) {
    apiKey = apiKeyArg
  } else if (def.envKey && process.env[def.envKey]) {
    apiKey = `env:${def.envKey}`
  } else {
    return {
      type: 'text' as const,
      value: [
        `🔑 ${def.name} needs an API key.`,
        `   /setup add ${idx + 1} your-api-key`,
        `   or: export ${def.envKey}=your-key && /setup add ${idx + 1}`,
      ].join('\n'),
    }
  }

  config.providers.push({
    name: def.slug,
    baseUrl: def.baseUrl.replace(/\/$/, ''),
    apiKey,
    model,
    priority: config.providers.length + 1,
    timeout: def.tags.includes('local') ? 120000 : 30000,
  })

  saveConfig(config)

  return {
    type: 'text' as const,
    value: `✅ ${def.name} added! Model: ${model}. Run /model to switch.`,
  }
}

function removeProvider(idx: number): { type: 'text'; value: string } {
  const config = loadConfig()
  const providers = config.providers ?? []

  if (isNaN(idx) || idx < 0 || idx >= providers.length) {
    return { type: 'text' as const, value: `❌ Invalid number. Run /model to see providers.` }
  }

  const removed = providers.splice(idx, 1)[0]!

  // Clear active if it was removed
  if (config.activeProvider === removed.name) {
    delete config.activeProvider
    delete config.activeModel
  }

  saveConfig(config)

  return {
    type: 'text' as const,
    value: `🗑️  Removed: ${removed.name} — ${removed.model}`,
  }
}
