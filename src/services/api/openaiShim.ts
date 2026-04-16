/**
 * OpenAI-compatible API shim for Claude Code.
 *
 * Translates Anthropic SDK calls (anthropic.beta.messages.create) into
 * OpenAI-compatible chat completion requests and streams back events
 * in the Anthropic streaming format so the rest of the codebase is unaware.
 *
 * Supports: OpenAI, Azure OpenAI, Ollama, LM Studio, OpenRouter,
 * Together, Groq, Fireworks, DeepSeek, Mistral, and any OpenAI-compatible API.
 *
 * Environment variables:
 *   CLAUDE_CODE_USE_OPENAI=1          — enable this provider
 *   OPENAI_API_KEY=sk-...             — API key (optional for local models)
 *   OPENAI_BASE_URL=http://...        — base URL (default: https://api.openai.com/v1)
 *   OPENAI_MODEL=gpt-4o              — default model override
 *   CODEX_API_KEY / ~/.codex/auth.json — Codex auth for codexplan/codexspark
 */

import {
  codexStreamToAnthropic,
  collectCodexCompletedResponse,
  convertCodexResponseToAnthropicMessage,
  performCodexRequest,
  type AnthropicStreamEvent,
  type AnthropicUsage,
  type ShimCreateParams,
} from './codexShim.js'
import {
  resolveCodexApiCredentials,
  resolveProviderRequest,
} from './providerConfig.js'
import {
  FallbackChain,
  shouldFallback,
} from './fallbackChain.js'
import {
  isGigaChatUrl,
  getGigaChatApiUrl,
  parseGigaChatCredentials,
  getGigaChatToken,
} from './gigachatAuth.js'
import { recordLatency } from './fallbackEnhanced.js'
import { logUsage } from '../usage/usageStore.js'
import { estimateTokens, parseApiUsage } from '../usage/tokenCounter.js'
import { calculateCost, calculateCostFromUsage } from '../usage/costCalculator.js'
import { enrichContext } from '../memory/contextEnricher.js'
import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import { parseProviderQualifiedModel } from '../../utils/freeclaudeConfig.js'

// ---------------------------------------------------------------------------
// Types — minimal subset of Anthropic SDK types we need to produce
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Message format conversion: Anthropic → OpenAI
// ---------------------------------------------------------------------------

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
    extra_content?: Record<string, unknown>
  }>
  tool_call_id?: string
  name?: string
}

interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
}

function convertSystemPrompt(
  system: unknown,
): string {
  if (!system) return ''
  if (typeof system === 'string') return system
  if (Array.isArray(system)) {
    return system
      .map((block: { type?: string; text?: string }) =>
        block.type === 'text' ? block.text ?? '' : '',
      )
      .join('\n\n')
  }
  return String(system)
}

function convertContentBlocks(
  content: unknown,
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content ?? '')

  const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push({ type: 'text', text: block.text ?? '' })
        break
      case 'image': {
        const src = block.source
        if (src?.type === 'base64') {
          parts.push({
            type: 'image_url',
            image_url: {
              url: `data:${src.media_type};base64,${src.data}`,
            },
          })
        } else if (src?.type === 'url') {
          parts.push({ type: 'image_url', image_url: { url: src.url } })
        }
        break
      }
      case 'tool_use':
        // handled separately
        break
      case 'tool_result':
        // handled separately
        break
      case 'thinking':
        // Append thinking as text with a marker for models that support reasoning
        if (block.thinking) {
          parts.push({ type: 'text', text: `<thinking>${block.thinking}</thinking>` })
        }
        break
      default:
        if (block.text) {
          parts.push({ type: 'text', text: block.text })
        }
    }
  }

  if (parts.length === 0) return ''
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text ?? ''
  return parts
}

function convertMessages(
  messages: Array<{ role: string; message?: { role?: string; content?: unknown }; content?: unknown }>,
  system: unknown,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  // System message first
  const sysText = convertSystemPrompt(system)
  if (sysText) {
    result.push({ role: 'system', content: sysText })
  }

  for (const msg of messages) {
    // Claude Code wraps messages in { role, message: { role, content } }
    const inner = msg.message ?? msg
    const role = (inner as { role?: string }).role ?? msg.role
    const content = (inner as { content?: unknown }).content

    if (role === 'user') {
      // Check for tool_result blocks in user messages
      if (Array.isArray(content)) {
        const toolResults = content.filter((b: { type?: string }) => b.type === 'tool_result')
        const otherContent = content.filter((b: { type?: string }) => b.type !== 'tool_result')

        // Emit tool results as tool messages
        for (const tr of toolResults) {
          const trContent = Array.isArray(tr.content)
            ? tr.content.map((c: { text?: string }) => c.text ?? '').join('\n')
            : typeof tr.content === 'string'
              ? tr.content
              : JSON.stringify(tr.content ?? '')
          result.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id ?? 'unknown',
            content: tr.is_error ? `Error: ${trContent}` : trContent,
          })
        }

        // Emit remaining user content
        if (otherContent.length > 0) {
          result.push({
            role: 'user',
            content: convertContentBlocks(otherContent),
          })
        }
      } else {
        result.push({
          role: 'user',
          content: convertContentBlocks(content),
        })
      }
    } else if (role === 'assistant') {
      // Check for tool_use blocks
      if (Array.isArray(content)) {
        const toolUses = content.filter((b: { type?: string }) => b.type === 'tool_use')
        const textContent = content.filter(
          (b: { type?: string }) => b.type !== 'tool_use' && b.type !== 'thinking',
        )

        const assistantMsg: OpenAIMessage = {
          role: 'assistant',
          content: convertContentBlocks(textContent) as string,
        }

        if (toolUses.length > 0) {
          assistantMsg.tool_calls = toolUses.map(
            (tu: {
              id?: string
              name?: string
              input?: unknown
              extra_content?: Record<string, unknown>
            }) => ({
              id: tu.id ?? `call_${Math.random().toString(36).slice(2)}`,
              type: 'function' as const,
              function: {
                name: tu.name ?? 'unknown',
                arguments:
                  typeof tu.input === 'string'
                    ? tu.input
                    : JSON.stringify(tu.input ?? {}),
              },
              ...(tu.extra_content ? { extra_content: tu.extra_content } : {}),
            }),
          )
        }

        result.push(assistantMsg)
      } else {
        result.push({
          role: 'assistant',
          content: convertContentBlocks(content) as string,
        })
      }
    }
  }

  return result
}

/**
 * OpenAI requires every key in `properties` to also appear in `required`.
 * Anthropic schemas often mark fields as optional (omitted from `required`),
 * which causes 400 errors on OpenAI/Codex endpoints. This normalizes the
 * schema by ensuring `required` is a superset of `properties` keys.
 */
function normalizeSchemaForOpenAI(
  schema: Record<string, unknown>,
  strict = true,
): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return (schema ?? {}) as Record<string, unknown>
  }

  const record = { ...schema }

  if (record.type === 'object' && record.properties) {
    const properties = record.properties as Record<string, Record<string, unknown>>
    const existingRequired = Array.isArray(record.required) ? record.required as string[] : []

    // Recurse into each property
    const normalizedProps: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(properties)) {
      normalizedProps[key] = normalizeSchemaForOpenAI(
        value as Record<string, unknown>,
        strict,
      )
    }
    record.properties = normalizedProps

    if (strict) {
      // OpenAI strict mode requires every property to be listed in required[]
      const allKeys = Object.keys(normalizedProps)
      record.required = Array.from(new Set([...existingRequired, ...allKeys]))
      // OpenAI strict mode requires additionalProperties: false on all object
      // schemas — override unconditionally to ensure nested objects comply.
      record.additionalProperties = false
    } else {
      // For Gemini: keep only existing required keys that are present in properties
      record.required = existingRequired.filter(k => k in normalizedProps)
    }
  }

  // Recurse into array items
  if ('items' in record) {
    if (Array.isArray(record.items)) {
      record.items = (record.items as unknown[]).map(
        item => normalizeSchemaForOpenAI(item as Record<string, unknown>, strict),
      )
    } else {
      record.items = normalizeSchemaForOpenAI(record.items as Record<string, unknown>, strict)
    }
  }

  // Recurse into combinators
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (key in record && Array.isArray(record[key])) {
      record[key] = (record[key] as unknown[]).map(
        item => normalizeSchemaForOpenAI(item as Record<string, unknown>, strict),
      )
    }
  }

  return record
}

function convertTools(
  tools: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>,
): OpenAITool[] {
  const isGemini =
    process.env.CLAUDE_CODE_USE_GEMINI === '1' ||
    process.env.CLAUDE_CODE_USE_GEMINI === 'true'

  return tools
    .filter(t => t.name !== 'ToolSearchTool') // Not relevant for OpenAI
    .map(t => {
      const schema = { ...(t.input_schema ?? { type: 'object', properties: {} }) } as Record<string, unknown>

      // For Codex/OpenAI: promote known Agent sub-fields into required[] only if
      // they actually exist in properties (Gemini rejects required keys absent from properties).
      if (t.name === 'Agent' && schema.properties) {
        const props = schema.properties as Record<string, unknown>
        if (!Array.isArray(schema.required)) schema.required = []
        const req = schema.required as string[]
        for (const key of ['message', 'subagent_type']) {
          if (key in props && !req.includes(key)) req.push(key)
        }
      }

      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description ?? '',
          parameters: normalizeSchemaForOpenAI(schema, !isGemini),
        },
      }
    })
}

// ---------------------------------------------------------------------------
// Streaming: OpenAI SSE → Anthropic stream events
// ---------------------------------------------------------------------------

interface OpenAIStreamChunk {
  id: string
  object: string
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
        extra_content?: Record<string, unknown>
      }>
    }
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

function makeMessageId(): string {
  return `msg_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function convertChunkUsage(
  usage: OpenAIStreamChunk['usage'] | undefined,
): Partial<AnthropicUsage> | undefined {
  if (!usage) return undefined

  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}

/**
 * Async generator that transforms an OpenAI SSE stream into
 * Anthropic-format BetaRawMessageStreamEvent objects.
 */
async function* openaiStreamToAnthropic(
  response: Response,
  model: string,
): AsyncGenerator<AnthropicStreamEvent> {
  const messageId = makeMessageId()
  let contentBlockIndex = 0
  const activeToolCalls = new Map<number, { id: string; name: string; index: number; jsonBuffer: string }>()
  let hasEmittedContentStart = false
  let lastStopReason: 'tool_use' | 'max_tokens' | 'end_turn' | null = null
  let hasEmittedFinalUsage = false
  let hasProcessedFinishReason = false

  // Emit message_start
  yield {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }

  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') continue
      if (!trimmed.startsWith('data: ')) continue

      let chunk: OpenAIStreamChunk
      try {
        chunk = JSON.parse(trimmed.slice(6))
      } catch {
        continue
      }

      const chunkUsage = convertChunkUsage(chunk.usage)

      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta

        // Text content — use != null to distinguish absent field from empty string,
        // some providers send "" as first delta to signal streaming start.
        // Also handle reasoning_content (ZAI GLM-5, DeepSeek-R1) which some providers
        // return instead of content.
        const textContent = delta.content ?? (delta as Record<string, unknown>).reasoning_content as string | null | undefined
        if (textContent != null) {
          if (!hasEmittedContentStart) {
            yield {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: { type: 'text', text: '' },
            }
            hasEmittedContentStart = true
          }
          yield {
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: { type: 'text_delta', text: textContent },
          }
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id && tc.function?.name) {
              // New tool call starting
              if (hasEmittedContentStart) {
                yield {
                  type: 'content_block_stop',
                  index: contentBlockIndex,
                }
                contentBlockIndex++
                hasEmittedContentStart = false
              }

              const toolBlockIndex = contentBlockIndex
              activeToolCalls.set(tc.index, {
                id: tc.id,
                name: tc.function.name,
                index: toolBlockIndex,
                jsonBuffer: tc.function.arguments ?? '',
              })

              yield {
                type: 'content_block_start',
                index: toolBlockIndex,
                content_block: {
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.function.name,
                  input: {},
                  ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
                },
              }
              contentBlockIndex++

              // Emit any initial arguments
              if (tc.function.arguments) {
                yield {
                  type: 'content_block_delta',
                  index: toolBlockIndex,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tc.function.arguments,
                  },
                }
              }
            } else if (tc.function?.arguments) {
              // Continuation of existing tool call
              const active = activeToolCalls.get(tc.index)
              if (active) {
                if (tc.function.arguments) {
                  active.jsonBuffer += tc.function.arguments
                }
                yield {
                  type: 'content_block_delta',
                  index: active.index,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: tc.function.arguments,
                  },
                }
              }
            }
          }
        }

        // Finish — guard ensures we only process finish_reason once even if
        // multiple chunks arrive with finish_reason set (some providers do this)
        if (choice.finish_reason && !hasProcessedFinishReason) {
          hasProcessedFinishReason = true

          // Close any open content blocks
          if (hasEmittedContentStart) {
            yield {
              type: 'content_block_stop',
              index: contentBlockIndex,
            }
          }
          // Close active tool calls
          for (const [, tc] of activeToolCalls) {
            let suffixToAdd = ''
            if (tc.jsonBuffer) {
              try {
                JSON.parse(tc.jsonBuffer)
              } catch {
                const str = tc.jsonBuffer.trimEnd()
                const combinations = [
                  '}', '"}', ']}', '"]}', '}}', '"}}', ']}}', '"]}}', '"]}]}', '}]}'
                ]
                for (const combo of combinations) {
                  try {
                    JSON.parse(str + combo)
                    suffixToAdd = combo
                    break
                  } catch {}
                }
              }
            }

            if (suffixToAdd) {
              yield {
                type: 'content_block_delta',
                index: tc.index,
                delta: {
                  type: 'input_json_delta',
                  partial_json: suffixToAdd,
                },
              }
            }

            yield { type: 'content_block_stop', index: tc.index }
          }

          const stopReason =
            choice.finish_reason === 'tool_calls'
              ? 'tool_use'
              : choice.finish_reason === 'length'
                ? 'max_tokens'
                : 'end_turn'
          lastStopReason = stopReason

          yield {
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            ...(chunkUsage ? { usage: chunkUsage } : {}),
          }
          if (chunkUsage) {
            hasEmittedFinalUsage = true
          }
        }
      }

      if (
        !hasEmittedFinalUsage &&
        chunkUsage &&
        (chunk.choices?.length ?? 0) === 0
      ) {
        yield {
          type: 'message_delta',
          delta: { stop_reason: lastStopReason, stop_sequence: null },
          usage: chunkUsage,
        }
        hasEmittedFinalUsage = true
      }
    }
    }
  } finally {
    reader.releaseLock()
  }

  yield { type: 'message_stop' }
}

// ---------------------------------------------------------------------------
// The shim client — duck-types as Anthropic SDK
// ---------------------------------------------------------------------------

class OpenAIShimStream {
  private generator: AsyncGenerator<AnthropicStreamEvent>
  // The controller property is checked by claude.ts to distinguish streams from error messages
  controller = new AbortController()

  constructor(generator: AsyncGenerator<AnthropicStreamEvent>) {
    this.generator = generator
  }

  async *[Symbol.asyncIterator]() {
    yield* this.generator
  }
}

class OpenAIShimMessages {
  private defaultHeaders: Record<string, string>
  private fallbackChain: FallbackChain

  constructor(defaultHeaders: Record<string, string>) {
    this.defaultHeaders = defaultHeaders
    this.fallbackChain = new FallbackChain()
  }

  create(
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    // If fallback chain is enabled (multiple providers), wrap with retry logic
    if (this.fallbackChain.isEnabled()) {
      return this._createWithFallback(params, options)
    }

    // Original behavior — single provider
    return this._createSingle(params, options)
  }

  /**
   * Fallback chain wrapper: tries multiple providers on 401/429/5xx errors.
   * Returns a thenable with .withResponse (same shape as _createSingle).
   */
  private _createWithFallback(
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    const self = this
    const chain = this.fallbackChain

    const promise = (async () => {
      // Enrich context with GBrain if available
      const lastUserMsg = Array.isArray(params.messages)
        ? params.messages
            ?.filter((m: Record<string, unknown>) => m.role === 'user')
            .pop()
        : undefined
      const userText = typeof lastUserMsg?.content === 'string'
        ? lastUserMsg.content
        : ''
      let enrichedContext = ''
      if (userText.length > 10) {
        try {
          const { enrichedSystemPrompt } = await enrichContext(userText)
          enrichedContext = enrichedSystemPrompt
        } catch {
          // Non-critical — silently continue without enrichment
        }
      }

      // Auto-load daily notes and memory into system prompt
      try {
        const { loadSessionContext } = await import('../memory/sessionContext.js')
        const sessionMemory = await loadSessionContext()
        if (sessionMemory) {
          enrichedContext = sessionMemory + (enrichedContext ? '\n\n' + enrichedContext : '')
        }
      } catch {
        // Non-critical
      }

      // Inject enriched context into system message if found
      if (enrichedContext) {
        const msgs = Array.isArray(params.messages) ? [...params.messages] : params.messages
        if (Array.isArray(msgs)) {
          const sysIdx = msgs.findIndex((m: Record<string, unknown>) => m.role === 'system')
          if (sysIdx >= 0) {
            const sysMsg = msgs[sysIdx]
            msgs[sysIdx] = {
              ...sysMsg,
              content: (sysMsg.content as string) + enrichedContext,
            }
          } else {
            msgs.unshift({ role: 'system', content: enrichedContext })
          }
          params = { ...params, messages: msgs }
        }
      }
      const mainLoopModelOverride = getMainLoopModelOverride()
      const requestedModelSelection = parseProviderQualifiedModel(
        mainLoopModelOverride ?? undefined,
        chain.getProviders(),
      )
      const explicitProviderName = requestedModelSelection?.providerName
      const explicitModel = requestedModelSelection?.model?.trim() || undefined
      const hasExplicitModel = Boolean(mainLoopModelOverride && explicitModel)
      const pinnedProvider =
        explicitProviderName
          ? chain.getProviders().find(
              provider => provider.name.toLowerCase() === explicitProviderName,
            )
          : undefined

      if (explicitProviderName && !pinnedProvider) {
        throw new Error(
          `[FreeClaude] Provider "${explicitProviderName}" is not configured for model ${params.model}`,
        )
      }

      let currentProvider = pinnedProvider ?? chain.getCurrent()

      // FreeClaude: if /model changed env vars, reload chain to pick up activeProvider
      const envBase = process.env.OPENAI_BASE_URL
      const envModel = process.env.OPENAI_MODEL
      if (envBase && envModel && currentProvider &&
          (currentProvider.baseUrl !== envBase || currentProvider.model !== envModel)) {
        chain.loadProviders()
        currentProvider =
          explicitProviderName
            ? chain.getProviders().find(
                provider => provider.name.toLowerCase() === explicitProviderName,
              ) ?? null
            : chain.getCurrent()
      }

      let lastError: Error | null = null
      const maxAttempts = hasExplicitModel ? 1 : chain.getProviders().length
      let startTime = 0

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (!currentProvider) break

        // Override env vars for this provider
        const prevApiKey = process.env.OPENAI_API_KEY
        const prevBaseUrl = process.env.OPENAI_BASE_URL
        const prevModel = process.env.OPENAI_MODEL

        process.env.OPENAI_API_KEY = currentProvider.apiKey
        process.env.OPENAI_BASE_URL = currentProvider.baseUrl
        process.env.OPENAI_MODEL = explicitModel || currentProvider.model

        try {
          const startTime = Date.now()
          const result = await self._createSingle(
            { ...params, model: explicitModel || currentProvider.model },
            options,
          )
          const durationMs = Date.now() - startTime
          chain.markSuccess(currentProvider.name)
          self._restoreEnv(prevApiKey, prevBaseUrl, prevModel)

          // Log usage — prefer actual API token counts when available
          const promptText = typeof params.messages === 'string'
            ? params.messages
            : JSON.stringify(params.messages ?? '')
          const completionText = typeof result === 'string'
            ? result
            : JSON.stringify(result?.content ?? result ?? '')

          // Try to get actual usage from result (non-streaming responses)
          let promptTokens: number
          let completionTokens: number

          const apiUsage = (result as Record<string, unknown>)?.usage as {
            input_tokens?: number
            output_tokens?: number
            prompt_tokens?: number
            completion_tokens?: number
          } | undefined

          if (apiUsage && (apiUsage.input_tokens || apiUsage.prompt_tokens)) {
            promptTokens = apiUsage.input_tokens ?? apiUsage.prompt_tokens ?? 0
            completionTokens = apiUsage.output_tokens ?? apiUsage.completion_tokens ?? 0
          } else {
            // Fall back to estimation
            promptTokens = estimateTokens(promptText)
            completionTokens = estimateTokens(completionText)
          }

          const costUsd = calculateCost(currentProvider.name, promptTokens, completionTokens)

          logUsage({
            timestamp: new Date().toISOString(),
            provider: currentProvider.name,
            model: explicitModel || currentProvider.model,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            costUsd,
            durationMs,
            fallback: attempt > 0,
          })

          const providerDescriptor = `${currentProvider.name}/${explicitModel || currentProvider.model}`
          console.error(
            `[FreeClaude] ${promptTokens + completionTokens} tokens (prompt: ${promptTokens}, completion: ${completionTokens}) | ${providerDescriptor} | $${costUsd.toFixed(4)}${attempt > 0 ? ' (fallback)' : ''} | ${durationMs}ms`,
          )

          // Record latency for health tracking
          recordLatency(currentProvider.name, durationMs, true)

          // Log conversation to daily notes (non-blocking, best-effort)
          try {
            const { logUserMessage, logAssistantMessage } = await import('../memory/conversationLogger.js')
            // Extract last user message
            const lastUser = Array.isArray(params.messages)
              ? params.messages
                  ?.filter((m: Record<string, unknown>) => m.role === 'user')
                  .pop()
              : undefined
            if (lastUser) {
              const userText = typeof lastUser.content === 'string'
                ? lastUser.content
                : JSON.stringify(lastUser.content ?? '')
              logUserMessage(userText)
            }
            // Extract assistant response
            if (typeof completionText === 'string' && completionText.length > 0) {
              logAssistantMessage(completionText)
            }
          } catch {
            // Non-critical — silently skip logging
          }

          return result
        } catch (error) {
          self._restoreEnv(prevApiKey, prevBaseUrl, prevModel)
          lastError = error as Error

          const match = (error as Error).message?.match(/OpenAI API error (\d+):/)
          const statusCode = match ? parseInt(match[1], 10) : 0

          // Import here to avoid circular deps
          const { isNetworkError } = await import('./fallbackChain.js')

          if (shouldFallback(statusCode) || isNetworkError(error as Error)) {
            const reason = statusCode > 0
              ? `HTTP ${statusCode}`
              : (error as Error).message?.slice(0, 60)
            if (hasExplicitModel) {
              console.error(
                `[FreeClaude] ${currentProvider.name} failed (${reason}), not switching providers because --model is pinned`,
              )
              throw error
            }
            console.error(
              `[FreeClaude] ${currentProvider.name} failed (${reason}), switching...`,
            )
            recordLatency(currentProvider.name, Date.now() - startTime, false)
            chain.markDown(currentProvider.name)
            currentProvider = chain.getNext(currentProvider.name)
          } else {
            throw error
          }
        }
      }

      throw lastError || new Error('[FreeClaude] All providers exhausted')
    })()

    // Attach .withResponse for compatibility with Anthropic SDK
    ;(promise as unknown as Record<string, unknown>).withResponse =
      async () => {
        const data = await promise
        return {
          data,
          response: new Response(),
          request_id: makeMessageId(),
        }
      }

    return promise
  }

  private _restoreEnv(
    prevApiKey: string | undefined,
    prevBaseUrl: string | undefined,
    prevModel: string | undefined,
  ): void {
    if (prevApiKey !== undefined) process.env.OPENAI_API_KEY = prevApiKey
    else delete process.env.OPENAI_API_KEY
    if (prevBaseUrl !== undefined) process.env.OPENAI_BASE_URL = prevBaseUrl
    else delete process.env.OPENAI_BASE_URL
    if (prevModel !== undefined) process.env.OPENAI_MODEL = prevModel
    else delete process.env.OPENAI_MODEL
  }

  /**
   * Original create logic (single provider, no fallback).
   */
  private _createSingle(
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ) {
    const self = this

    const promise = (async () => {
      const request = resolveProviderRequest({ model: params.model })
      const response = await self._doRequest(request, params, options)

      if (params.stream) {
        return new OpenAIShimStream(
          request.transport === 'codex_responses'
            ? codexStreamToAnthropic(response, request.resolvedModel)
            : openaiStreamToAnthropic(response, request.resolvedModel),
        )
      }

      if (request.transport === 'codex_responses') {
        const data = await collectCodexCompletedResponse(response)
        return convertCodexResponseToAnthropicMessage(
          data,
          request.resolvedModel,
        )
      }

      const data = await response.json()
      return self._convertNonStreamingResponse(data, request.resolvedModel)
    })()

      ; (promise as unknown as Record<string, unknown>).withResponse =
        async () => {
          const data = await promise
          return {
            data,
            response: new Response(),
            request_id: makeMessageId(),
          }
        }

    return promise
  }

  private async _doRequest(
    request: ReturnType<typeof resolveProviderRequest>,
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<Response> {
    if (request.transport === 'codex_responses') {
      const credentials = resolveCodexApiCredentials()
      if (!credentials.apiKey) {
        const authHint = credentials.authPath
          ? ` or place a Codex auth.json at ${credentials.authPath}`
          : ''
        throw new Error(
          `Codex auth is required for ${request.requestedModel}. Set CODEX_API_KEY${authHint}.`,
        )
      }
      if (!credentials.accountId) {
        throw new Error(
          'Codex auth is missing chatgpt_account_id. Re-login with the Codex CLI or set CHATGPT_ACCOUNT_ID/CODEX_ACCOUNT_ID.',
        )
      }

      return performCodexRequest({
        request,
        credentials,
        params,
        defaultHeaders: {
          ...this.defaultHeaders,
          ...(options?.headers ?? {}),
        },
        signal: options?.signal,
      })
    }

    return this._doOpenAIRequest(request, params, options)
  }

  private async _doOpenAIRequest(
    request: ReturnType<typeof resolveProviderRequest>,
    params: ShimCreateParams,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<Response> {
    const openaiMessages = convertMessages(
      params.messages as Array<{
        role: string
        message?: { role?: string; content?: unknown }
        content?: unknown
      }>,
      params.system,
    )

    const body: Record<string, unknown> = {
      model: request.resolvedModel,
      messages: openaiMessages,
      stream: params.stream ?? false,
    }
    // Convert max_tokens to max_completion_tokens for OpenAI API compatibility.
    // Azure OpenAI requires max_completion_tokens and does not accept max_tokens.
    // Ensure max_tokens is a valid positive number before using it.
    const maxTokensValue = typeof params.max_tokens === 'number' && params.max_tokens > 0
      ? params.max_tokens
      : undefined
    const maxCompletionTokensValue = typeof (params as Record<string, unknown>).max_completion_tokens === 'number'
      ? (params as Record<string, unknown>).max_completion_tokens as number
      : undefined

    if (maxTokensValue !== undefined) {
      body.max_completion_tokens = maxTokensValue
    } else if (maxCompletionTokensValue !== undefined) {
      body.max_completion_tokens = maxCompletionTokensValue
    }

    if (params.stream) {
      body.stream_options = { include_usage: true }
    }

    if (params.temperature !== undefined) body.temperature = params.temperature
    if (params.top_p !== undefined) body.top_p = params.top_p

    if (params.tools && params.tools.length > 0) {
      const converted = convertTools(
        params.tools as Array<{
          name: string
          description?: string
          input_schema?: Record<string, unknown>
        }>,
      )
      if (converted.length > 0) {
        body.tools = converted
        if (params.tool_choice) {
          const tc = params.tool_choice as { type?: string; name?: string }
          if (tc.type === 'auto') {
            body.tool_choice = 'auto'
          } else if (tc.type === 'tool' && tc.name) {
            body.tool_choice = {
              type: 'function',
              function: { name: tc.name },
            }
          } else if (tc.type === 'any') {
            body.tool_choice = 'required'
          } else if (tc.type === 'none') {
            body.tool_choice = 'none'
          }
        }
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.defaultHeaders,
      ...(options?.headers ?? {}),
    }

    const apiKey = process.env.OPENAI_API_KEY ?? ''
    const isAzure = /cognitiveservices\.azure\.com|openai\.azure\.com/.test(request.baseUrl)
    const isGigaChat = isGigaChatUrl(request.baseUrl)

    if (isGigaChat) {
      // GigaChat uses OAuth2 — exchange client credentials for access_token
      const { clientId, clientSecret } = parseGigaChatCredentials(apiKey)
      const accessToken = await getGigaChatToken(clientId, clientSecret)
      headers.Authorization = `Bearer ${accessToken}`
    } else if (apiKey) {
      if (isAzure) {
        headers['api-key'] = apiKey
      } else {
        headers.Authorization = `Bearer ${apiKey}`
      }
    }

    // Build the chat completions URL
    // Azure Cognitive Services / Azure OpenAI require a deployment-specific path
    // and an api-version query parameter.
    // Standard format: {base}/openai/deployments/{model}/chat/completions?api-version={version}
    // Non-Azure: {base}/chat/completions
    let chatCompletionsUrl: string
    if (isAzure) {
      const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-12-01-preview'
      const deployment = request.resolvedModel ?? process.env.OPENAI_MODEL ?? 'gpt-4o'
      // If base URL already contains /deployments/, use it as-is with api-version
      if (/\/deployments\//i.test(request.baseUrl)) {
        const base = request.baseUrl.replace(/\/+$/, '')
        chatCompletionsUrl = `${base}/chat/completions?api-version=${apiVersion}`
      } else {
        // Strip trailing /v1 or /openai/v1 if present, then build Azure path
        const base = request.baseUrl.replace(/\/(openai\/)?v1\/?$/, '').replace(/\/+$/, '')
        chatCompletionsUrl = `${base}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`
      }
    } else {
      chatCompletionsUrl = `${request.baseUrl}/chat/completions`
    }

    const response = await fetch(chatCompletionsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options?.signal,
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error')
      throw new Error(`OpenAI API error ${response.status}: ${errorBody}`)
    }

    return response
  }

  private _convertNonStreamingResponse(
    data: {
      id?: string
      model?: string
      choices?: Array<{
        message?: {
          role?: string
          content?: string | null
          tool_calls?: Array<{
            id: string
            function: { name: string; arguments: string }
            extra_content?: Record<string, unknown>
          }>
        }
        finish_reason?: string
      }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
      }
    },
    model: string,
  ) {
    const choice = data.choices?.[0]
    const content: Array<Record<string, unknown>> = []

    // Handle reasoning_content (ZAI GLM-5, DeepSeek-R1) — some providers
    // return reasoning_content instead of content in the final message.
    const messageContent = choice?.message?.content
      ?? (choice?.message as Record<string, unknown>)?.reasoning_content as string | null | undefined
    if (messageContent) {
      content.push({ type: 'text', text: messageContent })
    }

    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: unknown
        try {
          input = JSON.parse(tc.function.arguments)
        } catch {
          input = { raw: tc.function.arguments }
        }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
          ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
        })
      }
    }

    const stopReason =
      choice?.finish_reason === 'tool_calls'
        ? 'tool_use'
        : choice?.finish_reason === 'length'
          ? 'max_tokens'
          : 'end_turn'

    return {
      id: data.id ?? makeMessageId(),
      type: 'message',
      role: 'assistant',
      content,
      model: data.model ?? model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: data.usage?.prompt_tokens ?? 0,
        output_tokens: data.usage?.completion_tokens ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    }
  }
}

class OpenAIShimBeta {
  messages: OpenAIShimMessages

  constructor(defaultHeaders: Record<string, string>) {
    this.messages = new OpenAIShimMessages(defaultHeaders)
  }
}

export function createOpenAIShimClient(options: {
  defaultHeaders?: Record<string, string>
  maxRetries?: number
  timeout?: number
}): unknown {
  // When Gemini provider is active, map Gemini env vars to OpenAI-compatible ones
  // so the existing providerConfig.ts infrastructure picks them up correctly.
  if (
    process.env.CLAUDE_CODE_USE_GEMINI === '1' ||
    process.env.CLAUDE_CODE_USE_GEMINI === 'true'
  ) {
    process.env.OPENAI_BASE_URL ??=
      process.env.GEMINI_BASE_URL ??
      'https://generativelanguage.googleapis.com/v1beta/openai'
    process.env.OPENAI_API_KEY ??=
      process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? ''
    if (process.env.GEMINI_MODEL && !process.env.OPENAI_MODEL) {
      process.env.OPENAI_MODEL = process.env.GEMINI_MODEL
    }
  }

  const beta = new OpenAIShimBeta({
    ...(options.defaultHeaders ?? {}),
  })

  return {
    beta,
    messages: beta.messages,
  }
}
