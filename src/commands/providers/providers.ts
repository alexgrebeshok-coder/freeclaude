import type { LocalCommandCall } from '../../types/command.js'
import { existsSync } from 'node:fs'
import {
  getFreeClaudeConfigPath,
  getOrderedConfiguredProviders,
  normalizeFreeClaudeConfig,
  readFreeClaudeConfig,
  type FreeClaudeConfig,
  type FreeClaudeProviderConfig as Provider,
} from '../../utils/freeclaudeConfig.ts'

function maskKey(key: string): string {
  if (!key || key.length < 8) return '••••'
  return key.slice(0, 4) + '••••' + key.slice(-4)
}

async function testProvider(provider: Provider): Promise<{ ok: boolean; latency: number; error?: string }> {
  const start = Date.now()
  try {
    const url = provider.baseUrl.replace(/\/$/, '') + '/models'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), (provider.timeout ?? 10000) / 2)

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    clearTimeout(timeout)
    const latency = Date.now() - start

    if (res.ok) {
      return { ok: true, latency }
    }
    return { ok: false, latency, error: `HTTP ${res.status}` }
  } catch (err: any) {
    const latency = Date.now() - start
    return { ok: false, latency, error: err.code || err.message || 'unknown' }
  }
}

export const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()

  // /providers test — test connectivity
  if (trimmed === 'test') {
    return await showProviders(true)
  }

  // /providers — show config
  return await showProviders(false)
}

async function showProviders(test: boolean): Promise<{ type: 'text'; value: string }> {
  const configPath = getFreeClaudeConfigPath()
  if (!existsSync(configPath)) {
    return {
      type: 'text',
      value: [
        'No FreeClaude config found.',
        '',
        'Run /setup to auto-detect providers, or create ~/.freeclaude.json:',
        '',
        '```json',
        '{',
        '  "providers": [',
        '    {',
        '      "name": "zai",',
        '      "baseUrl": "https://api.z.ai/api/coding/paas/v4",',
        '      "apiKey": "your-key",',
        '      "model": "glm-4.7-flash"',
        '    }',
        '  ]',
        '}',
        '```',
      ].join('\n'),
    }
  }

  const rawConfig = readFreeClaudeConfig()
  if (!rawConfig) {
    return {
      type: 'text',
      value: `Error: Failed to parse ${configPath}`,
    }
  }

  const { config } = normalizeFreeClaudeConfig(rawConfig)
  const providers = config.providers ?? []
  if (providers.length === 0) {
    return {
      type: 'text',
      value: 'Config exists but no providers configured. Run /setup.',
    }
  }

  // Sort by priority
  const sorted = getOrderedConfiguredProviders(config)

  const lines = [`📡 Providers (${sorted.length})`, '']
  lines.push('| # | Name | Model | URL | Key |' + (test ? ' Status | Latency |' : ''))
  lines.push('|---|------|-------|-----|-----|' + (test ? '--------|---------|' : ''))

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!
    const name = p.name
    const model = p.model || 'default'
    const url = p.baseUrl.replace('https://', '').replace('http://', '').replace(/\/api.*$/, '')
    const key = maskKey(p.apiKey)

    if (test) {
      const result = await testProvider(p)
      const status = result.ok ? '✅' : '❌'
      const latency = `${result.latency}ms`
      const err = result.error ? ` (${result.error})` : ''
      lines.push(`| ${i + 1} | ${name} | ${model} | ${url} | ${key} | ${status} | ${latency}${err} |`)
    } else {
      lines.push(`| ${i + 1} | ${name} | ${model} | ${url} | ${key} |`)
    }
  }

  lines.push('')
  lines.push('Run /providers test to check connectivity.')
  lines.push('Run /setup to reconfigure.')

  return {
    type: 'text',
    value: lines.join('\n'),
  }
}
