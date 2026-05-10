import { safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  PROVIDER_CATALOG,
  ProviderCatalogItem,
  getProviderCatalogItem,
  normalizeProviderId
} from '../shared/provider-catalog';

export interface ProviderConfigUpdate {
  id: string;
  enabled?: boolean;
  baseUrl?: string;
  defaultModel?: string;
  customModels?: string[];
}

export interface ProviderKeyStatus {
  configured: boolean;
  encrypted: boolean;
  last4?: string;
  updatedAt?: number;
}

export interface ProviderInfo extends ProviderCatalogItem {
  enabled: boolean;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  configured: boolean;
  keyStatus: ProviderKeyStatus;
}

export interface ProvidersPayload {
  configured: boolean;
  activeProvider: string | null;
  activeModel: string | null;
  providers: ProviderInfo[];
  configPath: string;
  localConfigPath: string;
  cliPath: string | null;
  cliSource: string | null;
  encryptionAvailable: boolean;
}

export interface RuntimeProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  env: Record<string, string>;
}

export interface ProviderConnectionTestRequest {
  providerId: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface ProviderConnectionTestResult {
  ok: boolean;
  status?: number;
  message: string;
  models?: string[];
}

interface StoredProviderConfig {
  enabled?: boolean;
  baseUrl?: string;
  defaultModel?: string;
  customModels?: string[];
  apiKeyEncrypted?: string;
  apiKeyLast4?: string;
  apiKeyUpdatedAt?: number;
}

type StoredProviderConfigMap = Record<string, StoredProviderConfig>;

interface DesktopConfig extends Record<string, unknown> {
  provider?: string;
  model?: string;
  apiKey?: string;
  api_key?: string;
  providerConfigs?: StoredProviderConfigMap;
}

interface LocalProviderConfig {
  id: string;
  name: string;
  short: string;
  models: string[];
  baseUrl: string;
  apiKey: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function joinUrl(baseUrl: string, suffix: string): string {
  return `${normalizeBaseUrl(baseUrl)}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

export class ProviderConfigStore {
  constructor(
    private readonly desktopConfigPath: string,
    private readonly localConfigPath: string
  ) {}

  getDesktopConfigPath(): string {
    return this.desktopConfigPath;
  }

  getLocalConfigPath(): string {
    return this.localConfigPath;
  }

  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  readDesktopConfig(): DesktopConfig {
    try {
      if (fs.existsSync(this.desktopConfigPath)) {
        return JSON.parse(fs.readFileSync(this.desktopConfigPath, 'utf-8')) as DesktopConfig;
      }
    } catch {
      // Invalid settings should not break app boot; the UI can overwrite them.
    }
    return {};
  }

  writeDesktopConfig(config: DesktopConfig): void {
    fs.mkdirSync(path.dirname(this.desktopConfigPath), { recursive: true });
    fs.writeFileSync(this.desktopConfigPath, JSON.stringify(config, null, 2));
  }

  readLocalConfig(): Record<string, unknown> {
    try {
      if (fs.existsSync(this.localConfigPath)) {
        return JSON.parse(fs.readFileSync(this.localConfigPath, 'utf-8')) as Record<string, unknown>;
      }
    } catch {
      // Keep local CLI config read-only; malformed files simply do not contribute metadata.
    }
    return {};
  }

  migrateLegacyDesktopApiKey(): void {
    const config = this.readDesktopConfig();
    const legacyKey = asString(config.apiKey) || asString(config.api_key);
    if (!legacyKey) {
      return;
    }

    const providerId = normalizeProviderId(asString(config.provider));
    const providerConfigs = this.getStoredProviderConfigs(config);
    if (this.isEncryptionAvailable()) {
      providerConfigs[providerId] = {
        ...providerConfigs[providerId],
        apiKeyEncrypted: this.encryptApiKey(legacyKey),
        apiKeyLast4: legacyKey.slice(-4),
        apiKeyUpdatedAt: Date.now()
      };
      config.providerConfigs = providerConfigs;
    }
    delete config.apiKey;
    delete config.api_key;
    config.provider = providerId;
    this.writeDesktopConfig(config);
  }

  getProvidersPayload(cliPath: string | null, cliSource: string | null): ProvidersPayload {
    this.migrateLegacyDesktopApiKey();
    const config = this.readDesktopConfig();
    const providers = this.getProviderInfos(config);
    const activeProvider = this.resolveActiveProvider(config, providers);
    const active = providers.find((provider) => provider.id === activeProvider) || providers[0];
    const activeModel = this.resolveActiveModel(config, active);

    return {
      configured: providers.some((provider) => provider.enabled),
      activeProvider: activeProvider || null,
      activeModel: activeModel || null,
      providers,
      configPath: this.desktopConfigPath,
      localConfigPath: this.localConfigPath,
      cliPath,
      cliSource,
      encryptionAvailable: this.isEncryptionAvailable()
    };
  }

  saveProviderConfig(update: ProviderConfigUpdate): ProviderInfo {
    const providerId = normalizeProviderId(update.id);
    const config = this.readDesktopConfig();
    const providerConfigs = this.getStoredProviderConfigs(config);
    const current = providerConfigs[providerId] || {};
    providerConfigs[providerId] = {
      ...current,
      enabled: update.enabled ?? current.enabled ?? true,
      baseUrl: update.baseUrl !== undefined ? normalizeBaseUrl(update.baseUrl) : current.baseUrl,
      defaultModel: update.defaultModel !== undefined ? update.defaultModel.trim() : current.defaultModel,
      customModels: update.customModels ? uniqueStrings(update.customModels) : current.customModels
    };
    config.providerConfigs = providerConfigs;
    if (providerId === normalizeProviderId(asString(config.provider))) {
      config.provider = providerId;
      if (update.defaultModel !== undefined) {
        config.model = update.defaultModel.trim();
      }
    }
    this.writeDesktopConfig(config);
    return this.getProviderInfos(this.readDesktopConfig()).find((provider) => provider.id === providerId)!;
  }

  setActiveProvider(providerId: string, model?: string): RuntimeProviderConfig {
    const normalized = normalizeProviderId(providerId);
    const config = this.readDesktopConfig();
    const providers = this.getProviderInfos(config);
    const provider = providers.find((candidate) => candidate.id === normalized);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    if (!provider.enabled) {
      throw new Error(`Provider is disabled: ${provider.name}`);
    }
    config.provider = normalized;
    config.model = model?.trim() || provider.defaultModel || provider.models[0] || '';
    this.writeDesktopConfig(config);
    return this.resolveRuntimeConfig();
  }

  setProviderApiKey(providerId: string, apiKey: string): ProviderKeyStatus {
    if (!this.isEncryptionAvailable()) {
      throw new Error('Secure storage is unavailable on this system.');
    }
    const cleanKey = apiKey.trim();
    const normalized = normalizeProviderId(providerId);
    const config = this.readDesktopConfig();
    const providerConfigs = this.getStoredProviderConfigs(config);
    providerConfigs[normalized] = {
      ...providerConfigs[normalized],
      apiKeyEncrypted: cleanKey ? this.encryptApiKey(cleanKey) : undefined,
      apiKeyLast4: cleanKey ? cleanKey.slice(-4) : undefined,
      apiKeyUpdatedAt: cleanKey ? Date.now() : undefined
    };
    config.providerConfigs = providerConfigs;
    this.writeDesktopConfig(config);
    return this.getKeyStatus(providerConfigs[normalized]);
  }

  clearProviderApiKey(providerId: string): ProviderKeyStatus {
    const normalized = normalizeProviderId(providerId);
    const config = this.readDesktopConfig();
    const providerConfigs = this.getStoredProviderConfigs(config);
    providerConfigs[normalized] = {
      ...providerConfigs[normalized],
      apiKeyEncrypted: undefined,
      apiKeyLast4: undefined,
      apiKeyUpdatedAt: undefined
    };
    config.providerConfigs = providerConfigs;
    this.writeDesktopConfig(config);
    return this.getKeyStatus(providerConfigs[normalized]);
  }

  resolveRuntimeConfig(): RuntimeProviderConfig {
    this.migrateLegacyDesktopApiKey();
    const config = this.readDesktopConfig();
    const providers = this.getProviderInfos(config);
    const activeProvider = this.resolveActiveProvider(config, providers);
    const provider = providers.find((candidate) => candidate.id === activeProvider) || providers[0];
    const model = this.resolveActiveModel(config, provider);
    const apiKey = provider ? this.decryptProviderApiKey(provider.id) || this.getLocalProvider(provider.id)?.apiKey || '' : '';
    const baseUrl = provider?.baseUrl || '';

    return {
      provider: provider?.id || '',
      model,
      apiKey,
      baseUrl,
      env: this.buildProviderEnv(provider, model, apiKey, baseUrl)
    };
  }

  getResolvedConfigSummary(cliPath: string | null, cliSource: string | null): Record<string, unknown> {
    const runtime = this.resolveRuntimeConfig();
    const provider = getProviderCatalogItem(runtime.provider);
    return {
      provider: runtime.provider,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      apiKeyConfigured: Boolean(runtime.apiKey),
      apiKeyLast4: this.getProviderInfo(runtime.provider)?.keyStatus.last4,
      providerShort: provider.short,
      cliPath,
      cliSource,
      localConfigPath: this.localConfigPath,
      desktopConfigPath: this.desktopConfigPath
    };
  }

  getModels(providerId?: string): string[] {
    const config = this.readDesktopConfig();
    const providers = this.getProviderInfos(config);
    const id = normalizeProviderId(providerId || asString(config.provider));
    const provider = providers.find((candidate) => candidate.id === id) || providers[0];
    return provider ? provider.models : [];
  }

  async testConnection(request: ProviderConnectionTestRequest): Promise<ProviderConnectionTestResult> {
    const provider = this.getProviderInfo(request.providerId);
    if (!provider) {
      return { ok: false, message: 'Unknown provider' };
    }
    const baseUrl = normalizeBaseUrl(request.baseUrl || provider.baseUrl);
    if (!baseUrl) {
      return { ok: false, message: 'Base URL is required' };
    }
    const apiKey = request.apiKey?.trim() || this.decryptProviderApiKey(provider.id);
    if (provider.authRequired && !apiKey) {
      return { ok: false, message: 'API key is required' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const url = provider.kind === 'ollama' ? joinUrl(baseUrl, '/api/tags') : joinUrl(baseUrl, '/models');
      const headers: Record<string, string> = {};
      if (apiKey && provider.kind !== 'ollama') {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      const response = await fetch(url, { headers, signal: controller.signal });
      const data = await response.json().catch(() => undefined);
      const models = this.extractModelsFromResponse(provider.kind, data);
      return {
        ok: response.ok,
        status: response.status,
        message: response.ok ? 'Connection OK' : `HTTP ${response.status}`,
        models
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Connection failed'
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private getProviderInfo(providerId: string): ProviderInfo | undefined {
    return this.getProviderInfos(this.readDesktopConfig()).find((provider) => provider.id === normalizeProviderId(providerId));
  }

  private getStoredProviderConfigs(config: DesktopConfig): StoredProviderConfigMap {
    return config.providerConfigs && typeof config.providerConfigs === 'object'
      ? { ...config.providerConfigs }
      : {};
  }

  private getProviderInfos(config: DesktopConfig): ProviderInfo[] {
    const providerConfigs = this.getStoredProviderConfigs(config);
    const localProviders = this.getLocalProviders();
    const localById = new Map(localProviders.map((provider) => [provider.id, provider]));
    const catalog = [...PROVIDER_CATALOG];
    for (const local of localProviders) {
      if (!catalog.some((provider) => provider.id === local.id)) {
        catalog.push({
          id: local.id,
          name: local.name || local.id,
          short: local.short || local.id.toUpperCase().slice(0, 4),
          models: local.models,
          defaultBaseUrl: local.baseUrl,
          kind: 'custom',
          modelSource: 'manual',
          authRequired: true
        });
      }
    }

    return catalog.map((catalogItem) => {
      const stored = providerConfigs[catalogItem.id] || {};
      const local = localById.get(catalogItem.id);
      const models = uniqueStrings([
        ...(stored.customModels || []),
        ...(local?.models || []),
        ...catalogItem.models
      ]);
      const defaultModel = stored.defaultModel || models[0] || '';
      const baseUrl = normalizeBaseUrl(stored.baseUrl || local?.baseUrl || catalogItem.defaultBaseUrl);
      return {
        ...catalogItem,
        enabled: stored.enabled ?? true,
        baseUrl,
        defaultModel,
        models,
        configured: Boolean(stored.apiKeyEncrypted || local?.apiKey || !catalogItem.authRequired),
        keyStatus: this.getKeyStatus(stored, local?.apiKey)
      };
    });
  }

  private getLocalProviders(): LocalProviderConfig[] {
    const localConfig = this.readLocalConfig();
    const providers = Array.isArray(localConfig.providers) ? localConfig.providers : [];
    return providers
      .filter((provider): provider is Record<string, unknown> => Boolean(provider && typeof provider === 'object'))
      .map((provider) => {
        const id = normalizeProviderId(asString(provider.id) || asString(provider.provider) || asString(provider.name));
        const name = asString(provider.displayName) || asString(provider.label) || asString(provider.name) || id;
        const models = this.getProviderModels(provider);
        return {
          id,
          name,
          short:
            asString(provider.short) ||
            name
              .split(/\s+/)
              .map((part) => part[0])
              .join('')
              .slice(0, 4)
              .toUpperCase(),
          models,
          baseUrl: normalizeBaseUrl(asString(provider.baseUrl) || asString(provider.base_url)),
          apiKey: asString(provider.apiKey) || asString(provider.api_key) || asString(provider.key)
        };
      })
      .filter((provider) => provider.id);
  }

  private getLocalProvider(providerId: string): LocalProviderConfig | undefined {
    const normalized = normalizeProviderId(providerId);
    return this.getLocalProviders().find((provider) => provider.id === normalized);
  }

  private getProviderModels(provider: Record<string, unknown>): string[] {
    if (Array.isArray(provider.models)) {
      return uniqueStrings(provider.models.map((model) => {
        if (typeof model === 'string') {
          return model;
        }
        if (model && typeof model === 'object') {
          const obj = model as Record<string, unknown>;
          return asString(obj.id) || asString(obj.name) || asString(obj.model);
        }
        return '';
      }));
    }
    return uniqueStrings([asString(provider.model)]);
  }

  private resolveActiveProvider(config: DesktopConfig, providers: ProviderInfo[]): string {
    const localConfig = this.readLocalConfig();
    const raw = asString(config.provider) || asString(localConfig.activeProvider) || asString(localConfig.provider);
    const normalized = normalizeProviderId(raw);
    const provider = providers.find((candidate) => candidate.id === normalized && candidate.enabled)
      || providers.find((candidate) => candidate.enabled)
      || providers[0];
    return provider?.id || '';
  }

  private resolveActiveModel(config: DesktopConfig, provider?: ProviderInfo): string {
    if (!provider) {
      return '';
    }
    const localConfig = this.readLocalConfig();
    const model = asString(config.model) || asString(localConfig.activeModel) || asString(localConfig.model);
    return model || provider.defaultModel || provider.models[0] || '';
  }

  private encryptApiKey(apiKey: string): string {
    return safeStorage.encryptString(apiKey).toString('base64');
  }

  private decryptProviderApiKey(providerId: string): string {
    const stored = this.getStoredProviderConfigs(this.readDesktopConfig())[normalizeProviderId(providerId)];
    if (!stored?.apiKeyEncrypted || !this.isEncryptionAvailable()) {
      return '';
    }
    try {
      return safeStorage.decryptString(Buffer.from(stored.apiKeyEncrypted, 'base64'));
    } catch {
      return '';
    }
  }

  private getKeyStatus(stored?: StoredProviderConfig, localPlaintextKey?: string): ProviderKeyStatus {
    if (stored?.apiKeyEncrypted) {
      return {
        configured: true,
        encrypted: true,
        last4: stored.apiKeyLast4,
        updatedAt: stored.apiKeyUpdatedAt
      };
    }
    if (localPlaintextKey) {
      return {
        configured: true,
        encrypted: false,
        last4: localPlaintextKey.slice(-4)
      };
    }
    return { configured: false, encrypted: false };
  }

  private buildProviderEnv(provider: ProviderInfo | undefined, model: string, apiKey: string, baseUrl: string): Record<string, string> {
    if (!provider) {
      return {};
    }
    const env: Record<string, string> = {
      FREECLAUDE_PROVIDER: provider.id
    };
    if (model) {
      env.FREECLAUDE_MODEL = model;
    }
    if (apiKey) {
      env.FREECLAUDE_API_KEY = apiKey;
    }
    if (baseUrl) {
      env.FREECLAUDE_BASE_URL = baseUrl;
      if (provider.kind === 'gemini') {
        env.GEMINI_BASE_URL = baseUrl;
      } else if (provider.kind === 'anthropic') {
        env.ANTHROPIC_BASE_URL = baseUrl;
      } else {
        env.OPENAI_BASE_URL = provider.kind === 'ollama' && !baseUrl.endsWith('/v1') ? joinUrl(baseUrl, '/v1') : baseUrl;
      }
    }
    return env;
  }

  private extractModelsFromResponse(kind: ProviderCatalogItem['kind'], data: unknown): string[] {
    if (!data || typeof data !== 'object') {
      return [];
    }
    const obj = data as Record<string, unknown>;
    const list = kind === 'ollama' ? obj.models : obj.data;
    if (!Array.isArray(list)) {
      return [];
    }
    return uniqueStrings(list.map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (entry && typeof entry === 'object') {
        const model = entry as Record<string, unknown>;
        return asString(model.id) || asString(model.name) || asString(model.model);
      }
      return '';
    }));
  }
}
