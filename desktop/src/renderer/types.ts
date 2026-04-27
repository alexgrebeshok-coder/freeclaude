export type WorkspaceType =
  | 'home'
  | 'chat'
  | 'search'
  | 'plugins'
  | 'automations'
  | 'terminal'
  | 'files'
  | 'settings';

export type Provider = 'glm' | 'gemini' | 'qwen' | 'ollama' | 'deepseek';

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
  apiKey: string;
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
