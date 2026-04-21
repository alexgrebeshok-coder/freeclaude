import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
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

interface EnvProviderDefinition {
  name: string
  envKey: string
  modelEnvKey?: string
  baseUrl: string
  defaultModel: string
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

const ENV_PROVIDER_DEFINITIONS: EnvProviderDefinition[] = [
  {
    name: 'zai',
    envKey: 'ZAI_API_KEY',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    defaultModel: 'glm-5',
  },
  {
    name: 'gemini',
    envKey: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
  },
  {
    name: 'groq',
    envKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  {
    name: 'cerebras',
    envKey: 'CEREBRAS_API_KEY',
    baseUrl: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-4-scout-17b-16e',
  },
  {
    name: 'qwen',
    envKey: 'DASHSCOPE_API_KEY',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3-235b-a22b',
  },
  {
    name: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    modelEnvKey: 'OPENROUTER_MODEL',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'qwen/qwen3-coder-next',
  },
  {
    name: 'openai',
    envKey: 'OPENAI_API_KEY',
    modelEnvKey: 'OPENAI_MODEL',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  {
    name: 'deepseek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  {
    name: 'mistral',
    envKey: 'MISTRAL_API_KEY',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
  },
  {
    name: 'huggingface',
    envKey: 'HF_TOKEN',
    baseUrl: 'https://api-inference.huggingface.co/v1',
    defaultModel: '(any HF model ID)',
  },
  {
    name: 'together',
    envKey: 'TOGETHER_API_KEY',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct',
  },
  {
    name: 'fireworks',
    envKey: 'FIREWORKS_API_KEY',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v4p-70b-instruct',
  },
  {
    name: 'deepinfra',
    envKey: 'DEEPINFRA_API_KEY',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    defaultModel: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct',
  },
  {
    name: 'perplexity',
    envKey: 'PERPLEXITY_API_KEY',
    baseUrl: 'https://api.perplexity.ai',
    defaultModel: 'sonar-pro',
  },
  {
    name: 'siliconflow',
    envKey: 'SILICONFLOW_API_KEY',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
  },
  {
    name: 'sambanova',
    envKey: 'SAMBANOVA_API_KEY',
    baseUrl: 'https://api.sambanova.ai/v1',
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
  },
]

function normalizeBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl ?? '').trim().replace(/\/+$/, '').toLowerCase()
}

function normalizeName(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase()
}

export function resolveFreeClaudeApiKey(
  apiKey: string | undefined,
): string {
  let resolvedApiKey = apiKey?.trim() ?? ''
  if (resolvedApiKey.startsWith('env:')) {
    resolvedApiKey = process.env[resolvedApiKey.slice(4)]?.trim() ?? ''
  }
  return resolvedApiKey
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

const CONFIG_MAX_SIZE_BYTES = 1 * 1024 * 1024 // 1 MB sanity limit

export function readFreeClaudeConfig(): FreeClaudeConfig | null {
  const configPath = getFreeClaudeConfigPath()
  if (!existsSync(configPath)) {
    return null
  }

  try {
    const size = statSync(configPath).size
    if (size > CONFIG_MAX_SIZE_BYTES) {
      console.error(`[FreeClaude] Config file at ${configPath} is unexpectedly large (${size} bytes) — ignoring`)
      return null
    }
    return JSON.parse(readFileSync(configPath, 'utf-8')) as FreeClaudeConfig
  } catch (err) {
    console.error(`[FreeClaude] Failed to read/parse config at ${configPath}:`, err)
    return null
  }
}

export function writeFreeClaudeConfig(config: FreeClaudeConfig): void {
  const configPath = getFreeClaudeConfigPath()
  const tmpPath = `${configPath}.tmp.${process.pid}`
  writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  renameSync(tmpPath, configPath)
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

  const configuredProviderMatch = providers?.find(
    provider => normalizeName(provider.name) === providerPart,
  )
  const knownProviderMatch = configuredProviderMatch
    ? undefined
    : findKnownProviderDefinition({ name: providerPart })
  const providerMatch = configuredProviderMatch ?? knownProviderMatch

  if (!providerMatch) {
    return { model: trimmedModel }
  }

  if (
    !configuredProviderMatch &&
    knownProviderMatch &&
    !knownProviderMatch.models.some(
      candidate => normalizeName(candidate) === normalizeName(modelPart),
    )
  ) {
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

export function getActiveFreeClaudeProvider(
  config: FreeClaudeConfig | null = readFreeClaudeConfig(),
): FreeClaudeProviderConfig | undefined {
  const envBaseUrl = process.env.OPENAI_BASE_URL?.trim()
  const envModel = process.env.OPENAI_MODEL?.trim()
  const envApiKey = process.env.OPENAI_API_KEY?.trim()

  if (process.env.CLAUDE_CODE_USE_OPENAI === '1' && (envBaseUrl || envModel || envApiKey)) {
    const knownProvider = findKnownProviderDefinition({
      baseUrl: envBaseUrl,
    })

    return {
      name: knownProvider?.slug ?? 'openai',
      baseUrl: envBaseUrl ?? '',
      apiKey: envApiKey ?? '',
      model: envModel ?? '',
    }
  }

  const envProvider = ENV_PROVIDER_DEFINITIONS.find(spec =>
    !!resolveFreeClaudeApiKey(process.env[spec.envKey]),
  )
  if (envProvider) {
    const model =
      envProvider.modelEnvKey
        ? process.env[envProvider.modelEnvKey]?.trim() || envProvider.defaultModel
        : envProvider.defaultModel
    return {
      name: envProvider.name,
      baseUrl: envProvider.baseUrl,
      apiKey: process.env[envProvider.envKey] ?? '',
      model,
    }
  }

  if (!config) {
    return undefined
  }

  const orderedProviders = getOrderedConfiguredProviders(config)
  return (
    orderedProviders.find(provider => !!resolveFreeClaudeApiKey(provider.apiKey)) ??
    orderedProviders[0]
  )
}

export function hasActiveFreeClaudeProvider(
  config: FreeClaudeConfig | null = readFreeClaudeConfig(),
): boolean {
  const provider = getActiveFreeClaudeProvider(config)
  if (!provider) {
    return false
  }

  return !!resolveFreeClaudeApiKey(provider.apiKey)
}

export function getActiveFreeClaudeModel(
  fallbackModel?: string,
  config: FreeClaudeConfig | null = readFreeClaudeConfig(),
): string | undefined {
  return getActiveFreeClaudeProvider(config)?.model?.trim() || fallbackModel?.trim()
}
