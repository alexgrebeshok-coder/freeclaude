export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini' | 'ollama' | 'custom';
export type ModelSource = 'static' | 'openai-compatible' | 'ollama' | 'manual';

export interface ProviderPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface ProviderCatalogItem {
  id: string;
  name: string;
  short: string;
  models: string[];
  defaultBaseUrl: string;
  kind: ProviderKind;
  modelSource: ModelSource;
  authRequired: boolean;
  price?: ProviderPrice;
}

export const PROVIDER_CATALOG: ProviderCatalogItem[] = [
  {
    id: 'zai',
    name: 'Zhipu AI (GLM)',
    short: 'ZAI',
    models: ['glm-5.1', 'glm-5-flash', 'glm-4-air'],
    defaultBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
    kind: 'openai-compatible',
    modelSource: 'static',
    authRequired: true,
    price: { inputPerMillion: 0.6, outputPerMillion: 2.2 }
  },
  {
    id: 'openai',
    name: 'OpenAI',
    short: 'OpenAI',
    models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'],
    defaultBaseUrl: 'https://api.openai.com/v1',
    kind: 'openai-compatible',
    modelSource: 'static',
    authRequired: true,
    price: { inputPerMillion: 5, outputPerMillion: 15 }
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    short: 'OpenRouter',
    models: [],
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    kind: 'openai-compatible',
    modelSource: 'openai-compatible',
    authRequired: true
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    short: 'Claude',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4'],
    defaultBaseUrl: 'https://api.anthropic.com',
    kind: 'anthropic',
    modelSource: 'static',
    authRequired: true,
    price: { inputPerMillion: 3, outputPerMillion: 15 }
  },
  {
    id: 'google',
    name: 'Google Gemini',
    short: 'Gemini',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    kind: 'gemini',
    modelSource: 'static',
    authRequired: true,
    price: { inputPerMillion: 1.25, outputPerMillion: 10 }
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    short: 'DeepSeek',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    kind: 'openai-compatible',
    modelSource: 'static',
    authRequired: true,
    price: { inputPerMillion: 0.55, outputPerMillion: 2.19 }
  },
  {
    id: 'qwen',
    name: 'Alibaba Qwen',
    short: 'Qwen',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    kind: 'openai-compatible',
    modelSource: 'static',
    authRequired: true,
    price: { inputPerMillion: 1.2, outputPerMillion: 6 }
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    short: 'Grok',
    models: ['grok-4.3'],
    defaultBaseUrl: 'https://api.x.ai/v1',
    kind: 'openai-compatible',
    modelSource: 'static',
    authRequired: true,
    price: { inputPerMillion: 3, outputPerMillion: 15 }
  },
  {
    id: 'together',
    name: 'Together AI',
    short: 'Together',
    models: [],
    defaultBaseUrl: 'https://api.together.xyz/v1',
    kind: 'openai-compatible',
    modelSource: 'openai-compatible',
    authRequired: true
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    short: 'Ollama',
    models: [],
    defaultBaseUrl: 'http://localhost:11434',
    kind: 'ollama',
    modelSource: 'ollama',
    authRequired: false
  },
  {
    id: 'kimi',
    name: 'Moonshot Kimi',
    short: 'Kimi',
    models: ['kimi-k2.5', 'kimi-k2.5-coder'],
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    kind: 'openai-compatible',
    modelSource: 'static',
    authRequired: true
  },
  {
    id: 'yandex',
    name: 'YandexGPT',
    short: 'Yandex',
    models: ['yandexgpt', 'yandexgpt-lite'],
    defaultBaseUrl: 'https://llm.api.cloud.yandex.net/v1',
    kind: 'openai-compatible',
    modelSource: 'static',
    authRequired: true
  },
  {
    id: 'gigachat',
    name: 'GigaChat (Sber)',
    short: 'Sber',
    models: ['gigachat', 'gigachat-plus', 'gigachat-pro'],
    defaultBaseUrl: 'https://gigachat.devices.sberbank.ru/api/v1',
    kind: 'openai-compatible',
    modelSource: 'static',
    authRequired: true
  },
  {
    id: 'custom-1',
    name: 'Custom Provider 1',
    short: 'Custom',
    models: [],
    defaultBaseUrl: '',
    kind: 'custom',
    modelSource: 'manual',
    authRequired: true
  },
  {
    id: 'custom-2',
    name: 'Custom Provider 2',
    short: 'Custom',
    models: [],
    defaultBaseUrl: '',
    kind: 'custom',
    modelSource: 'manual',
    authRequired: true
  }
];

export function normalizeProviderId(providerId: string | null | undefined): string {
  if (!providerId) {
    return 'zai';
  }
  return providerId === 'glm' ? 'zai' : providerId;
}

export function getProviderCatalogItem(providerId: string | null | undefined): ProviderCatalogItem {
  const normalized = normalizeProviderId(providerId);
  return PROVIDER_CATALOG.find((provider) => provider.id === normalized) || PROVIDER_CATALOG[0];
}
