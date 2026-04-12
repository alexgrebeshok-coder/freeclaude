export const CLAUDE_CODE_USE_OPENAI = '1'

export type FreeClaudeAuthEnv = {
  apiKey?: string
  baseUrl?: string
  model?: string
}

export function getFreeClaudeAuthEnv(
  env: NodeJS.ProcessEnv = process.env,
): FreeClaudeAuthEnv {
  return {
    apiKey: env.OPENAI_API_KEY || env.CODEX_API_KEY,
    baseUrl: env.OPENAI_BASE_URL || env.OPENAI_API_BASE,
    model: env.OPENAI_MODEL,
  }
}
