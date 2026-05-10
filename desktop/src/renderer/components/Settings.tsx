import React, { useState, useEffect, useMemo } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { useAppVersion } from '../hooks/useAppVersion';
import { AppConfig, Provider } from '../types';

interface ProviderOption {
  id: Provider;
  name: string;
  short: string;
  models: string[];
  configured?: boolean;
}

interface ProvidersPayload {
  configured?: boolean;
  activeProvider?: string | null;
  activeModel?: string | null;
  providers?: ProviderOption[];
  configPath?: string;
  cliPath?: string | null;
  cliSource?: string | null;
}

const FALLBACK_PROVIDERS: ProviderOption[] = [
  {
    id: 'glm',
    name: 'GLM (Zhipu AI)',
    short: 'ZAI',
    models: ['glm-5.1', 'glm-4-air', 'glm-4-flash']
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    short: 'Gemini',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash']
  },
  {
    id: 'qwen',
    name: 'Alibaba Qwen',
    short: 'Qwen',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo']
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    short: 'Ollama',
    models: ['llama3', 'llama3.1', 'mistral', 'codellama']
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    short: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-coder']
  }
];

type SettingsTab = 'general' | 'providers' | 'models' | 'diagnostics' | 'about';

const tabButtonId = (id: SettingsTab) => `settings-tab-${id}`;
const tabPanelId = (id: SettingsTab) => `settings-panel-${id}`;

interface SettingsProps {
  config: AppConfig;
  onSave: (config: AppConfig) => Promise<void>;
}

type SettingsState = AppConfig;

export function Settings({ config, onSave }: SettingsProps): React.ReactElement {
  const { t } = useTranslation();
  const version = useAppVersion();
  const [settings, setSettings] = useState<SettingsState>({ ...config });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<SettingsTab>('providers');
  const [modelQuery, setModelQuery] = useState('');
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>(FALLBACK_PROVIDERS);
  const [providersMeta, setProvidersMeta] = useState<ProvidersPayload | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);

  // Diagnostics state
  const [logPath, setLogPath] = useState<string | null>(null);
  const [userDataPath, setUserDataPath] = useState<string | null>(null);
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: t('settings.tabs.general') },
    { id: 'providers', label: t('settings.tabs.providers') },
    { id: 'models', label: t('settings.tabs.models') },
    { id: 'diagnostics', label: t('settings.tabs.diagnostics') },
    { id: 'about', label: t('settings.tabs.about') }
  ];

  useEffect(() => {
    setSettings((prev) => ({ ...prev, ...config }));
  }, [config]);

  useEffect(() => {
    let cancelled = false;

    const loadProviders = async () => {
      try {
        const payload = await window.electron.freeclaude.getProviders() as ProvidersPayload | undefined;
        if (cancelled || !payload) return;

        setProvidersMeta(payload);
        setProvidersError(null);

        if (Array.isArray(payload.providers) && payload.providers.length > 0) {
          setProviderOptions(payload.providers);
          setSettings((prev) => ({
            ...prev,
            provider: (prev.provider || payload.activeProvider || payload.providers?.[0]?.id || '') as Provider,
            model: prev.model || payload.activeModel || payload.providers?.[0]?.models?.[0] || ''
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setProvidersError(error instanceof Error ? error.message : t('errors.loadProviders'));
        }
      }
    };

    const loadDiagnosticsInfo = async () => {
      try {
        const [lp, ud, telemetry] = await Promise.all([
          window.electron.app.getLogPath() as Promise<string>,
          window.electron.paths.userData() as Promise<string>,
          window.electron.config.get('telemetryEnabled') as Promise<boolean | null>
        ]);
        if (cancelled) return;
        setLogPath(lp ?? null);
        setUserDataPath(ud ?? null);
        setTelemetryEnabled(telemetry === true);
      } catch {
        // non-fatal — diagnostics UI degrades gracefully
      }
    };

    void loadProviders();
    void loadDiagnosticsInfo();

    return () => {
      cancelled = true;
    };
  }, [t]);

  const currentProvider = providerOptions.find((p) => p.id === settings.provider);

  const filteredModels = useMemo(() => {
    const list = currentProvider?.models?.length
      ? currentProvider.models
      : (settings.model ? [settings.model] : []);
    const q = modelQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => m.toLowerCase().includes(q));
  }, [currentProvider, modelQuery, settings.model]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await onSave({
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model,
        theme: settings.theme,
        fontSize: settings.fontSize
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('app.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const lastIndex = TABS.length - 1;
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') {
      nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = lastIndex;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = TABS[nextIndex];
    setTab(nextTab.id);
    window.requestAnimationFrame(() => {
      document.getElementById(tabButtonId(nextTab.id))?.focus();
    });
  };

  const handleTelemetryChange = async (enabled: boolean) => {
    setTelemetryEnabled(enabled);
    try {
      await window.electron.config.set('telemetryEnabled', enabled);
    } catch {
      // revert on failure
      setTelemetryEnabled(!enabled);
    }
  };

  const handleResetSettings = async () => {
    if (!window.confirm(t('settings.reset.confirm'))) return;
    try {
      localStorage.clear();
      await onSave({
        provider: 'glm',
        apiKey: '',
        model: 'glm-5.1',
        theme: 'light',
        fontSize: 14
      });
      window.location.reload();
    } catch {
      // ignore — page reload will fix state anyway
    }
  };

  const handleOpenLogFolder = async () => {
    try {
      await window.electron.app.openLogFolder();
    } catch (err) {
      console.warn('[settings] openLogFolder failed:', err);
    }
  };

  const handleOpenConfig = async (filePath: string) => {
    try {
      await window.electron.shell.openExternal(`file://${filePath}`);
    } catch (err) {
      console.warn('[settings] openExternal failed:', err);
    }
  };

  return (
    <div className="settings-container settings-container-tabs">
      <div className="settings-header">
        <h1>{t('settings.title')}</h1>
        <p>{t('settings.subtitle')}</p>
      </div>

      <div className="settings-tablist" role="tablist" aria-label={t('settings.tabs.label')}>
        {TABS.map((tabItem, index) => (
          <button
            key={tabItem.id}
            id={tabButtonId(tabItem.id)}
            type="button"
            role="tab"
            aria-selected={tab === tabItem.id}
            aria-controls={tabPanelId(tabItem.id)}
            tabIndex={tab === tabItem.id ? 0 : -1}
            className={`settings-tab ${tab === tabItem.id ? 'active' : ''}`}
            onClick={() => setTab(tabItem.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      <div
        id={tabPanelId(tab)}
        className="settings-content settings-tab-panel"
        role="tabpanel"
        aria-labelledby={tabButtonId(tab)}
        tabIndex={0}
      >
        {tab === 'general' && (
          <section className="settings-section settings-animate-in">
            <h2>{t('settings.tabs.general')}</h2>

            <div className="setting-field">
              <label htmlFor="theme">{t('settings.theme.label')}</label>
              <select
                id="theme"
                value={settings.theme}
                onChange={(e) => setSettings((prev) => ({
                  ...prev,
                  theme: e.target.value as AppConfig['theme']
                }))}
              >
                <option value="auto">{t('settings.theme.auto')}</option>
                <option value="light">{t('settings.theme.light')}</option>
                <option value="dark">{t('settings.theme.dark')}</option>
              </select>
            </div>

            <div className="theme-preview-grid">
              <div className="theme-preview theme-preview-light">
                <span>{t('settings.theme.light')}</span>
              </div>
              <div className="theme-preview theme-preview-dark">
                <span>{t('settings.theme.dark')}</span>
              </div>
            </div>

            <div className="setting-field">
              <label htmlFor="language">{t('settings.language.label')}</label>
              <select
                id="language"
                value={i18next.language?.startsWith('ru') ? 'ru' : 'en'}
                onChange={(e) => void i18next.changeLanguage(e.target.value)}
              >
                <option value="ru">{t('settings.language.ru')}</option>
                <option value="en">{t('settings.language.en')}</option>
              </select>
            </div>

            <div className="setting-field">
              <label htmlFor="fontSize">{t('settings.fontSize.label')} ({settings.fontSize}px)</label>
              <input
                id="fontSize"
                type="range"
                min={10}
                max={20}
                value={settings.fontSize}
                onChange={(e) => setSettings((prev) => ({ ...prev, fontSize: parseInt(e.target.value, 10) }))}
              />
            </div>
          </section>
        )}

        {tab === 'providers' && (
          <section className="settings-section settings-animate-in">
            <h2>{t('settings.tabs.providers')}</h2>
            <p className="settings-lead">
              {t('settings.providers.lead')}{providersMeta?.configPath ? `: ${providersMeta.configPath}` : ''}.
            </p>
            {providersError && <p className="settings-save-error" role="alert">{providersError}</p>}
            {providersMeta && (
              <p className="setting-hint">
                CLI: {providersMeta.cliPath ? `${providersMeta.cliPath} (${providersMeta.cliSource || 'auto'})` : t('settings.providers.cliNotFound')}
              </p>
            )}
            <div className="provider-card-grid">
              {providerOptions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`provider-card ${settings.provider === p.id ? 'selected' : ''}`}
                  onClick={() => {
                    const defaultModel = p.models[0] || '';
                    setSettings((prev) => ({ ...prev, provider: p.id, model: defaultModel }));
                  }}
                >
                  <span className="provider-card-badge">{p.short}</span>
                  <span className="provider-card-name">{p.name}</span>
                  {!p.configured && <span className="setting-hint">{t('settings.providers.fallback')}</span>}
                </button>
              ))}
            </div>

            <div className="setting-field setting-field-spaced">
              <label htmlFor="apiKey">{t('settings.providers.apiKeyLabel')}</label>
              <input
                id="apiKey"
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder={t('settings.providers.apiKeyPlaceholder')}
                autoComplete="off"
              />
              <p className="setting-hint">{t('settings.providers.apiKeyHint')}</p>
            </div>
          </section>
        )}

        {tab === 'models' && (
          <section className="settings-section settings-animate-in">
            <h2>{t('settings.tabs.models')}</h2>
            <p className="settings-lead">{t('settings.models.currentProvider')}: {currentProvider?.name || settings.provider}</p>
            <div className="setting-field">
              <label htmlFor="modelSearch">{t('settings.models.search')}</label>
              <input
                id="modelSearch"
                value={modelQuery}
                onChange={(e) => setModelQuery(e.target.value)}
                placeholder={t('settings.models.searchPlaceholder')}
              />
            </div>
            <div className="model-list">
              {filteredModels.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`model-row ${settings.model === m ? 'selected' : ''}`}
                  onClick={() => setSettings((prev) => ({ ...prev, model: m }))}
                >
                  <span>{m}</span>
                </button>
              ))}
              {filteredModels.length === 0 && (
                <div className="rail-empty">
                  {t('settings.models.empty')}
                </div>
              )}
            </div>
          </section>
        )}

        {tab === 'diagnostics' && (
          <section className="settings-section settings-animate-in">
            <h2>{t('settings.tabs.diagnostics')}</h2>

            <div className="settings-diag-group">
              <div className="setting-field-inline">
                <span>{t('settings.telemetry.label')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={telemetryEnabled}
                  className={`settings-toggle ${telemetryEnabled ? 'on' : 'off'}`}
                  onClick={() => void handleTelemetryChange(!telemetryEnabled)}
                >
                  {telemetryEnabled ? t('settings.telemetry.on') : t('settings.telemetry.off')}
                </button>
              </div>
              <p className="setting-hint">{t('settings.telemetry.description')}</p>
            </div>

            <div className="settings-diag-group">
              <div className="settings-diag-buttons">
                {providersMeta?.configPath && (
                  <button
                    type="button"
                    className="ghost-action-button"
                    onClick={() => void handleOpenConfig(providersMeta.configPath!)}
                  >
                    {t('settings.config.openLocal')}
                  </button>
                )}
                {userDataPath && (
                  <button
                    type="button"
                    className="ghost-action-button"
                    onClick={() => void handleOpenConfig(userDataPath)}
                  >
                    {t('settings.config.openDesktop')}
                  </button>
                )}
                <button
                  type="button"
                  className="ghost-action-button"
                  onClick={() => void handleOpenLogFolder()}
                >
                  {t('settings.logs.open')}
                </button>
              </div>
              {logPath && (
                <p className="setting-hint">{t('settings.logs.reveal')}: <code>{logPath}</code></p>
              )}
            </div>

            <div className="settings-diag-group">
              <button
                type="button"
                className="ghost-action-button ghost-action-button-danger"
                onClick={() => void handleResetSettings()}
              >
                {t('settings.reset.label')}
              </button>
            </div>
          </section>
        )}

        {tab === 'about' && (
          <section className="settings-section settings-animate-in">
            <h2>{t('settings.tabs.about')}</h2>
            <div className="about-info">
              <p><strong>FreeClaude Desktop</strong></p>
              <p>{t('settings.about.version')} {version}</p>
              <p>{t('settings.about.description')}</p>
              <div className="about-links">
                <button type="button" onClick={() => void window.electron.shell.openExternal('https://github.com/freeclaude')}>
                  GitHub
                </button>
                <button type="button" onClick={() => void window.electron.shell.openExternal('https://freeclaude.dev')}>
                  {t('settings.about.website')}
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      <div className="settings-footer">
        {saveError && (
          <p className="settings-save-error" role="alert">
            {saveError}
          </p>
        )}
        <button type="button" className="save-button" onClick={() => void handleSave()} disabled={saving} aria-live="polite">
          {saving ? t('app.loading') : saved ? t('settings.saved') : t('settings.saveChanges')}
        </button>
      </div>
    </div>
  );
}
