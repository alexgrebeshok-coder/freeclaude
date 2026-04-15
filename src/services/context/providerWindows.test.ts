import { describe, test, expect } from 'bun:test'

describe('Provider Windows', () => {
  test('getModelWindow returns known models', async () => {
    const { getModelWindow } = await import('./providerWindows.ts')

    const claude = getModelWindow('claude-sonnet-4')
    expect(claude.contextWindow).toBe(200_000)
    expect(claude.maxOutput).toBe(64_000)

    const gpt = getModelWindow('gpt-4o')
    expect(gpt.contextWindow).toBe(128_000)

    const gemini = getModelWindow('gemini-2.5-pro')
    expect(gemini.contextWindow).toBe(1_000_000)
  })

  test('getModelWindow fuzzy matches', async () => {
    const { getModelWindow } = await import('./providerWindows.ts')

    // Model with suffix should still match
    const result = getModelWindow('gpt-4o-2024-11-20')
    expect(result.contextWindow).toBe(128_000)
  })

  test('getModelWindow returns default for unknown models', async () => {
    const { getModelWindow } = await import('./providerWindows.ts')

    const result = getModelWindow('totally-unknown-model-xyz')
    expect(result.contextWindow).toBe(128_000) // default
    expect(result.maxOutput).toBe(8_192)       // default
  })

  test('isLargeContext identifies large context models', async () => {
    const { isLargeContext } = await import('./providerWindows.ts')

    expect(isLargeContext('claude-sonnet-4')).toBe(true)  // 200K > 128K
    expect(isLargeContext('gpt-4.1')).toBe(true)          // 1M
    expect(isLargeContext('gemini-2.5-pro')).toBe(true)    // 1M
    expect(isLargeContext('gigachat-pro')).toBe(false)     // 32K
  })

  test('getContextWindowForProvider returns number', async () => {
    const { getContextWindowForProvider } = await import('./providerWindows.ts')
    expect(getContextWindowForProvider('qwen3')).toBe(32_768)
  })

  test('formatModelWindow produces readable output', async () => {
    const { formatModelWindow } = await import('./providerWindows.ts')

    const output = formatModelWindow('claude-sonnet-4')
    expect(output).toContain('200K')
    expect(output).toContain('64K')
    expect(output).toContain('$3')
  })
})
