/**
 * FreeClaude startup screen — filled-block text logo with sunset gradient.
 * Called once at CLI startup before the Ink UI renders.
 */

declare const MACRO: { VERSION: string; DISPLAY_VERSION?: string }

const ESC = '\x1b['
const RESET = `${ESC}0m`
const DIM = `${ESC}2m`

type RGB = [number, number, number]
const rgb = (r: number, g: number, b: number) => `${ESC}38;2;${r};${g};${b}m`

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function gradAt(stops: RGB[], t: number): RGB {
  const c = Math.max(0, Math.min(1, t))
  const s = c * (stops.length - 1)
  const i = Math.floor(s)
  if (i >= stops.length - 1) return stops[stops.length - 1]
  return lerp(stops[i], stops[i + 1], s - i)
}

function paintLine(text: string, stops: RGB[], lineT: number): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const t = text.length > 1 ? lineT * 0.5 + (i / (text.length - 1)) * 0.5 : lineT
    const [r, g, b] = gradAt(stops, t)
    out += `${rgb(r, g, b)}${text[i]}`
  }
  return out + RESET
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const SUNSET_GRAD: RGB[] = [
  [240, 160, 48],
  [232, 140, 60],
  [220, 120, 55],
  [200, 100, 50],
  [170, 80, 50],
  [140, 65, 45],
]

const ACCENT: RGB = [240, 160, 48]
const GREEN: RGB = [48, 208, 144]
const CREAM: RGB = [224, 208, 192]
const DIMCOL: RGB = [120, 100, 82]
const BORDER: RGB = [100, 80, 65]

// ─── FreeClaude Logo ────────────────────────────────────────────────────────

const LOGO_FREE = [
  `______ _____ `,
  `|  ____/ ____|`,
  `| |__ | |     `,
  `|  __|| |     `,
  `| |   | |____ `,
  `|_|    \\_____|`,
]

// ─── Provider detection (reads from ~/.freeclaude.json) ──────────────────────

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface ConfigProvider {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  priority: number
  timeout: number
}

function detectProvider(): { name: string; model: string; baseUrl: string; isLocal: boolean; label: string } {
  const configPath = join(homedir(), '.freeclaude.json')

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8')
      const config = JSON.parse(raw)
      if (Array.isArray(config.providers) && config.providers.length > 0) {
        const sorted = [...config.providers].sort((a: ConfigProvider, b: ConfigProvider) => a.priority - b.priority)
        for (const p of sorted) {
          let apiKey = p.apiKey
          if (typeof apiKey === 'string' && apiKey.startsWith('env:')) {
            apiKey = process.env[apiKey.slice(4)] || ''
          }
          if (apiKey) {
            const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(p.baseUrl)
            const label = isLocal ? 'local' : 'free'
            return {
              name: p.name,
              model: p.model,
              baseUrl: p.baseUrl,
              isLocal,
              label,
            }
          }
        }
      }
    } catch {
      // fall through
    }
  }

  // Fallback to env vars
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const model = process.env.OPENAI_MODEL || 'gpt-4o'
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(baseUrl)
  let name = 'OpenAI'
  if (/z\.ai/i.test(baseUrl)) name = 'ZAI'
  else if (/deepseek/i.test(baseUrl)) name = 'DeepSeek'
  else if (/openrouter/i.test(baseUrl)) name = 'OpenRouter'
  else if (/localhost:11434/i.test(baseUrl)) name = 'Ollama'

  return { name, model, baseUrl, isLocal, label: isLocal ? 'local' : 'cloud' }
}

// ─── Box drawing ──────────────────────────────────────────────────────────────

function boxRow(content: string, width: number, rawLen: number): string {
  const pad = Math.max(0, width - 2 - rawLen)
  return `${rgb(...BORDER)}\u2502${RESET}${content}${' '.repeat(pad)}${rgb(...BORDER)}\u2502${RESET}`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function printStartupScreen(): void {
  // Skip in non-interactive / CI / print mode
  if (process.env.CI || !process.stdout.isTTY) return

  const p = detectProvider()
  const W = 62
  const out: string[] = []

  out.push('')

  // Gradient logo
  const total = LOGO_FREE.length
  for (let i = 0; i < total; i++) {
    const t = total > 1 ? i / (total - 1) : 0
    out.push(`  ${rgb(...ACCENT)}${LOGO_FREE[i]}${RESET}`)
  }

  out.push('')

  // Tagline
  out.push(`  ${rgb(...ACCENT)}\u2726${RESET} ${rgb(...CREAM)}Free AI coding assistant \u2014 any model, zero cost${RESET} ${rgb(...ACCENT)}\u2726${RESET}`)
  out.push('')

  // Provider info box
  out.push(`${rgb(...BORDER)}\u2554${'\u2550'.repeat(W - 2)}\u2557${RESET}`)

  const lbl = (k: string, v: string, c: RGB = CREAM): [string, number] => {
    const padK = k.padEnd(9)
    return [` ${DIM}${rgb(...DIMCOL)}${padK}${RESET} ${rgb(...c)}${v}${RESET}`, ` ${padK} ${v}`.length]
  }

  const provC: RGB = p.isLocal ? GREEN : ACCENT
  let [r, l] = lbl('Provider', `${p.name} (${p.label})`, provC)
  out.push(boxRow(r, W, l))
  ;[r, l] = lbl('Model', p.model)
  out.push(boxRow(r, W, l))
  const ep = p.baseUrl.length > 38 ? p.baseUrl.slice(0, 35) + '...' : p.baseUrl
  ;[r, l] = lbl('Endpoint', ep)
  out.push(boxRow(r, W, l))

  out.push(`${rgb(...BORDER)}\u2560${'\u2550'.repeat(W - 2)}\u2563${RESET}`)

  const sC: RGB = GREEN
  const sRow = ` ${rgb(...sC)}\u25cf${RESET} ${DIM}${rgb(...DIMCOL)}Ready${RESET}    ${DIM}${rgb(...DIMCOL)}Type ${RESET}${rgb(...ACCENT)}/help${RESET}${DIM}${rgb(...DIMCOL)} to begin \u00b7 ${RESET}${rgb(...ACCENT)}/model${RESET}${DIM}${rgb(...DIMCOL)} to switch${RESET}`
  const sLen = ` \u25cf Ready    Type /help to begin \u00b7 /model to switch`.length
  out.push(boxRow(sRow, W, sLen))

  out.push(`${rgb(...BORDER)}\u255a${'\u2550'.repeat(W - 2)}\u255d${RESET}`)
  out.push(`  ${DIM}${rgb(...DIMCOL)}freeclaude ${RESET}${rgb(...ACCENT)}v${MACRO.DISPLAY_VERSION ?? MACRO.VERSION}${RESET}`)
  out.push('')

  // Set terminal title
  process.stdout.write('\x1b]0;FreeClaude\x07')

  process.stdout.write(out.join('\n') + '\n')
}
