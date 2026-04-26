import React, { useState, useEffect } from 'react';

type Provider = 'glm' | 'gemini' | 'qwen' | 'ollama' | 'deepseek';

interface SettingsState {
  provider: Provider;
  apiKey: string;
  model: string;
  theme: 'light' | 'dark' | 'auto';
  fontSize: number;
  enableTelemetry: boolean;
}

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

export function Settings(): React.ReactElement {
  const [settings, setSettings] = useState<SettingsState>({
    provider: 'glm',
    apiKey: '',
    model: 'glm-5.1',
    theme: 'dark',
    fontSize: 14,
    enableTelemetry: false
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Load settings
    const loadSettings = async () => {
      const provider = await window.electron.config.get('provider') as Provider;
      const apiKey = await window.electron.config.get('apiKey') as string;
      const model = await window.electron.config.get('model') as string;
      const theme = await window.electron.config.get('theme') as 'light' | 'dark' | 'auto';
      const fontSize = await window.electron.config.get('fontSize') as number;

      setSettings(prev => ({
        ...prev,
        provider: provider || 'glm',
        apiKey: apiKey || '',
        model: model || 'glm-5.1',
        theme: theme || 'dark',
        fontSize: fontSize || 14
      }));
    };

    loadSettings();
  }, []);

  const handleSave = async () => {
    await window.electron.config.set('provider', settings.provider);
    await window.electron.config.set('apiKey', settings.apiKey);
    await window.electron.config.set('model', settings.model);
    await window.electron.config.set('theme', settings.theme);
    await window.electron.config.set('fontSize', settings.fontSize);

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const currentProvider = PROVIDERS.find(p => p.id === settings.provider);

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1>Settings</h1>
        <p>Configure FreeClaude Desktop preferences</p>
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
              Your API key is stored locally and never shared.
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
              <option value="light">Light</option>
              <option value="dark">Dark</option>
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
            <p>Version {window.electron?.app?.getVersion?.() || '0.1.0'}</p>
            <p>A free, open-source AI coding assistant.</p>
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
        <button className="save-button" onClick={handleSave}>
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
