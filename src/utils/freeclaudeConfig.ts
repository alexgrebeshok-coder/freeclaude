import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface FreeClaudeProviderConfig {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  priority?: number
  timeout?: number
}

export interface FreeClaudeConfig {
  providers?: FreeClaudeProviderConfig[]
  activeProvider?: string
  activeModel?: string
  defaults?: {
    maxRetries?: number
    retryDelay?: number
    logLevel?: string
  }
}

interface KnownProviderDefinition {
  slug: string
  baseUrl: string
  models: string[]
}

const KNOWN_PROVIDER_DEFINITIONS: KnownProviderDefinition[] = [
  {
    slug: 'zai',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    models: ['glm-5', 'glm-4.7-flash', 'glm-4.7'],
  },
  {
    slug: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
  },
  {
    slug: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      'llama-3.3-70b-versatile',
      'llama-4-scout-17b-16e-instruct',
      'qwen-qwq-32b',
    ],
  },
  {
    slug: 'cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    models: ['llama-4-scout-17b-16e', 'llama3.1-8b', 'qwen-2.5-32b'],
  },
  {
    slug: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-8B'],
  },
  {
    slug: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      'qwen3-235b-a22b',
      'qwen-max',
      'qwen-plus',
      'qwen-turbo',
      'qwen-coder-plus',
    ],
  },
  {
    slug: 'sambanova',
    baseUrl: 'https://api.sambanova.ai/v1',
    models: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-R1-Distill-Llama-70B'],
  },
  {
    slug: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen2.5:3b', 'qwen2.5:7b', 'llama3.2', 'deepseek-r1:8b'],
  },
  {
    slug: 'lmstudio',
    baseUrl: 'http://localhost:1234/v1',
    models: ['(auto-detected)'],
  },
  {
    slug: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  },
  {
    slug: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
  },
  {
    slug: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'codestral-latest'],
  },
  {
    slug: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-flash',
      'openai/gpt-4o',
      'deepseek/deepseek-chat',
    ],
  },
  {
    slug: 'together',
    baseUrl: 'https://api.together.xyz/v1',
    models: [
      'meta-llama/Llama-4-Maverick-17B-128E-Instruct',
      'Qwen/Qwen3-235B-A22B',
    ],
  },
  {
    slug: 'fireworks',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    models: ['accounts/fireworks/models/llama-v4p-70b-instruct'],
  },
  {
    slug: 'deepinfra',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    models: [
      'meta-llama/Llama-4-Maverick-17B-128E-Instruct',
      'Qwen/Qwen3-235B-A22B',
    ],
  },
  {
    slug: 'perplexity',
    baseUrl: 'https://api.perplexity.ai',
    models: ['sonar-pro', 'sonar-reasoning'],
  },
  {
    slug: 'huggingface',
    baseUrl: 'https://api-inference.huggingface.co/v1',
    models: ['(any HF model ID)'],
  },
]

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl ?? '').trim().replace(/\/+$/, '').toLowerCase()
}

function normalizeName(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase()
}

function cloneProvider(
  provider: FreeClaudeProviderConfig,
): FreeClaudeProviderConfig {
  return { ...provider }
}

export type ParsedProviderQualifiedModel = {
  providerName?: string
  model: string
}

export function getFreeClaudeConfigPath(): string {
  return process.env.FREECLAUDE_CONFIG_PATH || join(homedir(), '.freeclaude.json')
}

export function readFreeClaudeConfig(): FreeClaudeConfig | null {
  const configPath = getFreeClaudeConfigPath()
  if (!existsSync(configPath)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as FreeClaudeConfig
  } catch {
    return null
  }
}

export function writeFreeClaudeConfig(config: FreeClaudeConfig): void {
  writeFileSync(
    getFreeClaudeConfigPath(),
    JSON.stringify(config, null, 2) + '\n',
    'utf-8',
  )
}

export function findKnownProviderDefinition(provider: {
  name?: string
  baseUrl?: string
}): KnownProviderDefinition | undefined {
  const baseUrl = normalizeBaseUrl(provider.baseUrl)
  if (baseUrl) {
    const byBaseUrl = KNOWN_PROVIDER_DEFINITIONS.find(
      entry => normalizeBaseUrl(entry.baseUrl) === baseUrl,
    )
    if (byBaseUrl) {
      return byBaseUrl
    }
  }

  const name = normalizeName(provider.name)
  if (!name) {
    return undefined
  }

  return KNOWN_PROVIDER_DEFINITIONS.find(
    entry => normalizeName(entry.slug) === name,
  )
}

export function resolveConfiguredProviderModel(
  provider: {
    name?: string
    baseUrl?: string
  },
  model: string | undefined,
): string | undefined {
  const trimmedModel = model?.trim()
  const knownProvider = findKnownProviderDefinition(provider)

  if (!trimmedModel) {
    return knownProvider?.models[0]
  }

  if (!knownProvider) {
    return trimmedModel
  }

  if (/^\d+$/.test(trimmedModel)) {
    const index = Number.parseInt(trimmedModel, 10) - 1
    if (index >= 0 && index < knownProvider.models.length) {
      return knownProvider.models[index]
    }
  }

  return trimmedModel
}

export function parseProviderQualifiedModel(
  model: string | undefined,
  providers?: Array<{
    name?: string
    baseUrl?: string
  }>,
): ParsedProviderQualifiedModel | undefined {
  const trimmedModel = model?.trim()
  if (!trimmedModel) {
    return undefined
  }

  const slashIndex = trimmedModel.indexOf('/')
  if (slashIndex <= 0) {
    return { model: trimmedModel }
  }

  const providerPart = normalizeName(trimmedModel.slice(0, slashIndex))
  const modelPart = trimmedModel.slice(slashIndex + 1).trim()
  if (!providerPart || !modelPart) {
    return { model: trimmedModel }
  }

  const providerMatch =
    providers?.find(provider => normalizeName(provider.name) === providerPart) ??
    findKnownProviderDefinition({ name: providerPart })

  if (!providerMatch) {
    return { model: trimmedModel }
  }

  const providerName =
    'slug' in providerMatch ? providerMatch.slug : providerMatch.name

  return {
    providerName: normalizeName(providerName),
    model: modelPart,
  }
}

export function normalizeFreeClaudeConfig(config: FreeClaudeConfig): {
  config: FreeClaudeConfig
  changed: boolean
} {
  const providers = (config.providers ?? []).map(cloneProvider)
  let changed = false

  for (const provider of providers) {
    const resolvedModel = resolveConfiguredProviderModel(provider, provider.model)
    if (resolvedModel && resolvedModel !== provider.model) {
      provider.model = resolvedModel
      changed = true
    }
  }

  const normalized: FreeClaudeConfig = {
    ...config,
    providers,
  }

  const activeProvider =
    normalized.activeProvider
      ? providers.find(provider => provider.name === normalized.activeProvider)
      : providers.length === 1
        ? providers[0]
        : undefined

  const resolvedActiveModel = resolveConfiguredProviderModel(
    activeProvider ?? { name: normalized.activeProvider },
    normalized.activeModel,
  )

  if (
    resolvedActiveModel &&
    normalized.activeModel &&
    resolvedActiveModel !== normalized.activeModel
  ) {
    normalized.activeModel = resolvedActiveModel
    changed = true
  }

  return {
    config: normalized,
    changed,
  }
}

export function getOrderedConfiguredProviders(
  config: FreeClaudeConfig,
): FreeClaudeProviderConfig[] {
  const { config: normalized } = normalizeFreeClaudeConfig(config)
  const providers = [...(normalized.providers ?? [])].sort(
    (a, b) => (a.priority ?? 999) - (b.priority ?? 999),
  )

  if (!normalized.activeProvider) {
    return providers
  }

  const activeIdx = providers.findIndex(
    provider => provider.name === normalized.activeProvider,
  )
  if (activeIdx < 0) {
    return providers
  }

  const [activeProvider] = providers.splice(activeIdx, 1)
  if (activeProvider && normalized.activeModel) {
    activeProvider.model =
      resolveConfiguredProviderModel(activeProvider, normalized.activeModel) ??
      activeProvider.model
  }
  providers.unshift(activeProvider!)
  return providers
}
