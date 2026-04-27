import React, { useState, useEffect } from 'react';
import { useAppVersion } from '../hooks/useAppVersion';
import { AppConfig, Provider } from '../types';

const PROVIDERS: { id: Provider; name: string; models: string[] }[] = [
  {
    id: 'glm',
    name: 'GLM (Zhipu AI)',
    models: ['glm-5.1', 'glm-4-air', 'glm-4-flash']
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash']
  },
  {
    id: 'qwen',
    name: 'Alibaba Qwen',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo']
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    models: ['llama3', 'llama3.1', 'mistral', 'codellama']
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-coder']
  }
];

interface SettingsProps {
  config: AppConfig;
  onSave: (config: AppConfig) => Promise<void>;
}

interface SettingsState extends AppConfig {
  enableTelemetry: boolean;
}

export function Settings({ config, onSave }: SettingsProps): React.ReactElement {
  const version = useAppVersion();
  const [settings, setSettings] = useState<SettingsState>({
    ...config,
    enableTelemetry: false
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSettings((prev) => ({
      ...prev,
      ...config
    }));
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      provider: settings.provider,
      apiKey: settings.apiKey,
      model: settings.model,
      theme: settings.theme,
      fontSize: settings.fontSize
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const currentProvider = PROVIDERS.find(p => p.id === settings.provider);

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1>Настройки</h1>
        <p>Все параметры применяются к desktop shell и к backend bridge без потери рабочего контекста.</p>
      </div>

      <div className="settings-content">
        <section className="settings-section">
          <h2>AI Provider</h2>

          <div className="setting-field">
            <label htmlFor="provider">Provider</label>
            <select
              id="provider"
              value={settings.provider}
              onChange={(e) => {
                const provider = e.target.value as Provider;
                const defaultModel = PROVIDERS.find(p => p.id === provider)?.models[0] || '';
                setSettings(prev => ({ ...prev, provider, model: defaultModel }));
              }}
            >
              {PROVIDERS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="setting-field">
            <label htmlFor="model">Model</label>
            <select
              id="model"
              value={settings.model}
              onChange={(e) => setSettings(prev => ({ ...prev, model: e.target.value }))}
            >
              {currentProvider?.models.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="setting-field">
            <label htmlFor="apiKey">API Key</label>
            <input
              id="apiKey"
              type="password"
              value={settings.apiKey}
              onChange={(e) => setSettings(prev => ({ ...prev, apiKey: e.target.value }))}
              placeholder="Enter your API key"
            />
            <p className="setting-hint">
              Ключ хранится локально и используется текущим bridge-конфигом.
            </p>
          </div>
        </section>

        <section className="settings-section">
          <h2>Appearance</h2>

          <div className="setting-field">
            <label htmlFor="theme">Theme</label>
            <select
              id="theme"
              value={settings.theme}
              onChange={(e) => setSettings(prev => ({ ...prev, theme: e.target.value as 'light' | 'dark' | 'auto' }))}
            >
              <option value="light">Milk light</option>
              <option value="dark">Dark contrast</option>
              <option value="auto">Auto (System)</option>
            </select>
          </div>

          <div className="setting-field">
            <label htmlFor="fontSize">Font Size ({settings.fontSize}px)</label>
            <input
              id="fontSize"
              type="range"
              min={10}
              max={20}
              value={settings.fontSize}
              onChange={(e) => setSettings(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
            />
          </div>
        </section>

        <section className="settings-section">
          <h2>About</h2>
          <div className="about-info">
            <p><strong>FreeClaude Desktop</strong></p>
            <p>Version {version}</p>
            <p>Desktop AI workspace with Codex-inspired structure and FreeClaude styling.</p>
            <div className="about-links">
              <button onClick={() => window.electron.shell.openExternal('https://github.com/freeclaude')}>
                GitHub
              </button>
              <button onClick={() => window.electron.shell.openExternal('https://freeclaude.dev')}>
                Website
              </button>
            </div>
          </div>
        </section>
      </div>

      <div className="settings-footer">
        <button className="save-button" onClick={handleSave} disabled={saving}>
          {saving ? 'Сохраняем…' : saved ? 'Сохранено' : 'Сохранить изменения'}
        </button>
      </div>
    </div>
  );
}
