import type { ProviderCatalogItem, ProviderPrice } from '../shared/provider-catalog';

export type WorkspaceType =
  | 'home'
  | 'chat'
  | 'search'
  | 'plugins'
  | 'automations'
  | 'terminal'
  | 'files'
  | 'settings';

export type Provider = string;

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
  configured: boolean;
  keyStatus: ProviderKeyStatus;
  price?: ProviderPrice;
}

export interface ProvidersPayload {
  configured?: boolean;
  activeProvider?: string | null;
  activeModel?: string | null;
  providers?: ProviderInfo[];
  configPath?: string;
  localConfigPath?: string;
  cliPath?: string | null;
  cliSource?: string | null;
  encryptionAvailable?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ChatSession {
  id: string;
  title: string;
  projectId: string;
  sessionId?: string;
  messages: Message[];
  draft: string;
  isGenerating: boolean;
  streamingMessage: string;
  updatedAt: number;
  lastError?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  subtitle: string;
  contextLabel: string;
  lastOpenedAt: number;
}

export interface AppConfig {
  provider: Provider;
  model: string;
  theme: 'light' | 'dark' | 'auto';
  fontSize: number;
}

export interface FilePreview {
  path: string;
  content: string;
}

export interface WorkspaceSelection {
  type: WorkspaceType;
  id?: string;
}
