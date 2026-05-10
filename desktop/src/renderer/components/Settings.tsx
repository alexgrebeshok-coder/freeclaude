import React, { useEffect, useMemo, useState } from 'react';
import i18next from 'i18next';
import { useAppTranslation } from '../hooks/useAppTranslation';
import { useAppVersion } from '../hooks/useAppVersion';
import { AppConfig, Provider, ProviderInfo, ProvidersPayload } from '../types';
import { normalizeProviderId } from '../../shared/provider-catalog';

type SettingsTab = 'general' | 'providers' | 'models' | 'diagnostics' | 'about';
type SettingsState = AppConfig;

interface SettingsProps {
  config: AppConfig;
  providersMeta: ProvidersPayload | null;
  providerOptions: ProviderInfo[];
  onProvidersReload: () => Promise<ProvidersPayload | undefined>;
  onProviderChange: (providerId: string, model?: string) => Promise<void>;
  onSave: (config: AppConfig) => Promise<void>;
}

interface ProviderDraft {
  enabled: boolean;
  baseUrl: string;
  defaultModel: string;
  customModelsText: string;
}

interface TestState {
  status: 'idle' | 'testing' | 'success' | 'error';
  message?: string;
  models?: string[];
}

const tabButtonId = (id: SettingsTab) => `settings-tab-${id}`;
const tabPanelId = (id: SettingsTab) => `settings-panel-${id}`;

function makeProviderDraft(provider: ProviderInfo): ProviderDraft {
  return {
    enabled: provider.enabled,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel || provider.models[0] || '',
    customModelsText: ''
  };
}

function parseCustomModels(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function Settings({
  config,
  providersMeta,
  providerOptions,
  onProvidersReload,
  onProviderChange,
  onSave
}: SettingsProps): React.ReactElement {
  const { t } = useAppTranslation();
  const version = useAppVersion();
  const [settings, setSettings] = useState<SettingsState>({ ...config });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<SettingsTab>('providers');
  const [modelQuery, setModelQuery] = useState('');
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({});
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

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
    setProviderDrafts((prev) => {
      const next = { ...prev };
      for (const provider of providerOptions) {
        if (!next[provider.id]) {
          next[provider.id] = makeProviderDraft(provider);
        }
      }
      return next;
    });
  }, [providerOptions]);

  useEffect(() => {
    let cancelled = false;

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

    void loadDiagnosticsInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentProvider = providerOptions.find((p) => p.id === settings.provider) || providerOptions[0];

  const filteredModels = useMemo(() => {
    const list = currentProvider?.models?.length
      ? currentProvider.models
      : (settings.model ? [settings.model] : []);
    const q = modelQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => m.toLowerCase().includes(q));
  }, [currentProvider, modelQuery, settings.model]);

  const updateProviderDraft = (providerId: string, patch: Partial<ProviderDraft>) => {
    const meta = providerOptions.find((p) => p.id === providerId);
    if (!meta) {
      return;
    }
    setProviderDrafts((prev) => ({
      ...prev,
      [providerId]: {
        ...(prev[providerId] || makeProviderDraft(meta)),
        ...patch
      }
    }));
  };

  const refreshProviders = async () => {
    try {
      await onProvidersReload();
      setProvidersError(null);
    } catch (error) {
      setProvidersError(error instanceof Error ? error.message : t('errors.loadProviders'));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await onSave({
        provider: normalizeProviderId(settings.provider),
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

  const handleProviderSave = async (provider: ProviderInfo) => {
    const draft = providerDrafts[provider.id] || makeProviderDraft(provider);
    await window.electron.providers.saveConfig({
      id: provider.id,
      enabled: draft.enabled,
      baseUrl: draft.baseUrl,
      defaultModel: draft.defaultModel,
      customModels: parseCustomModels(draft.customModelsText)
    });
    if (settings.provider === provider.id) {
      setSettings((prev) => ({ ...prev, model: draft.defaultModel || prev.model }));
    }
    await refreshProviders();
  };

  const handleProviderKeySave = async (provider: ProviderInfo) => {
    const apiKey = apiKeyInputs[provider.id]?.trim() || '';
    await window.electron.providers.setApiKey(provider.id, apiKey);
    setApiKeyInputs((prev) => ({ ...prev, [provider.id]: '' }));
    await refreshProviders();
  };

  const handleProviderKeyClear = async (provider: ProviderInfo) => {
    await window.electron.providers.clearApiKey(provider.id);
    await refreshProviders();
  };

  const handleProviderTest = async (provider: ProviderInfo) => {
    const draft = providerDrafts[provider.id] || makeProviderDraft(provider);
    setTestStates((prev) => ({ ...prev, [provider.id]: { status: 'testing' } }));
    try {
      const result = await window.electron.providers.testConnection({
        providerId: provider.id,
        baseUrl: draft.baseUrl,
        apiKey: apiKeyInputs[provider.id]?.trim() || undefined
      }) as { ok: boolean; message: string; status?: number; models?: string[] };
      setTestStates((prev) => ({
        ...prev,
        [provider.id]: {
          status: result.ok ? 'success' : 'error',
          message: result.status ? `${result.message} (${result.status})` : result.message,
          models: result.models
        }
      }));
    } catch (error) {
      setTestStates((prev) => ({
        ...prev,
        [provider.id]: {
          status: 'error',
          message: error instanceof Error ? error.message : t('app.error')
        }
      }));
    }
  };

  const handleProviderActivate = async (provider: ProviderInfo) => {
    const draft = providerDrafts[provider.id] || makeProviderDraft(provider);
    const nextModel = draft.defaultModel || provider.defaultModel || provider.models[0] || '';
    await onProviderChange(provider.id, nextModel);
    setSettings((prev) => ({ ...prev, provider: provider.id as Provider, model: nextModel }));
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
      setTelemetryEnabled(!enabled);
    }
  };

  const handleResetSettings = async () => {
    if (!window.confirm(t('settings.reset.confirm'))) return;
    try {
      localStorage.clear();
      await onSave({
        provider: 'zai',
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
              Провайдеры и ключи хранятся в desktop settings. Ключи шифруются через Electron safeStorage.
            </p>
            {providersError && <p className="settings-save-error" role="alert">{providersError}</p>}
            {providersMeta && (
              <p className="setting-hint">
                CLI: {providersMeta.cliPath ? `${providersMeta.cliPath} (${providersMeta.cliSource || 'auto'})` : t('settings.providers.cliNotFound')} ·
                secure storage: {providersMeta.encryptionAvailable ? 'available' : 'unavailable'}
              </p>
            )}

            <div className="provider-card-grid provider-card-grid-detailed">
              {providerOptions.map((provider) => {
                const draft = providerDrafts[provider.id] || makeProviderDraft(provider);
                const test = testStates[provider.id] || { status: 'idle' };
                return (
                  <article
                    key={provider.id}
                    className={`provider-card provider-card-detailed ${settings.provider === provider.id ? 'selected' : ''}`}
                  >
                    <div className="provider-card-main">
                      <span className="provider-card-badge">{provider.short}</span>
                      <div>
                        <h3 className="provider-card-name">{provider.name}</h3>
                        <p className="setting-hint">
                          {provider.modelSource === 'static' ? `${provider.models.length} models` : provider.modelSource}
                          {' · '}
                          {provider.keyStatus.configured ? `key configured${provider.keyStatus.last4 ? ` · ****${provider.keyStatus.last4}` : ''}` : 'no key'}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={draft.enabled}
                        className={`settings-toggle ${draft.enabled ? 'on' : 'off'}`}
                        onClick={() => updateProviderDraft(provider.id, { enabled: !draft.enabled })}
                      >
                        {draft.enabled ? t('settings.telemetry.on') : t('settings.telemetry.off')}
                      </button>
                    </div>

                    <div className="provider-config-grid">
                      <label className="setting-field">
                        <span>Base URL</span>
                        <input
                          value={draft.baseUrl}
                          onChange={(event) => updateProviderDraft(provider.id, { baseUrl: event.target.value })}
                          placeholder="https://api.example.com/v1"
                        />
                      </label>
                      <label className="setting-field">
                        <span>Default model</span>
                        <input
                          value={draft.defaultModel}
                          onChange={(event) => updateProviderDraft(provider.id, { defaultModel: event.target.value })}
                          list={`models-${provider.id}`}
                        />
                        <datalist id={`models-${provider.id}`}>
                          {provider.models.map((model) => <option key={model} value={model} />)}
                        </datalist>
                      </label>
                    </div>

                    <label className="setting-field">
                      <span>Custom models (comma or newline separated)</span>
                      <textarea
                        rows={2}
                        value={draft.customModelsText}
                        onChange={(event) => updateProviderDraft(provider.id, { customModelsText: event.target.value })}
                        placeholder="model-a, model-b"
                      />
                    </label>

                    <div className="provider-key-row">
                      <input
                        type="password"
                        value={apiKeyInputs[provider.id] || ''}
                        onChange={(event) => setApiKeyInputs((prev) => ({ ...prev, [provider.id]: event.target.value }))}
                        placeholder={provider.authRequired ? t('settings.providers.apiKeyPlaceholder') : 'No key required'}
                        autoComplete="off"
                      />
                      <button type="button" className="ghost-action-button" onClick={() => void handleProviderKeySave(provider)}>
                        Save key
                      </button>
                      <button type="button" className="ghost-action-button" onClick={() => void handleProviderKeyClear(provider)}>
                        Clear
                      </button>
                    </div>

                    <div className="provider-card-actions">
                      <button type="button" className="ghost-action-button" onClick={() => void handleProviderSave(provider)}>
                        Save provider
                      </button>
                      <button type="button" className="ghost-action-button" onClick={() => void handleProviderActivate(provider)}>
                        Use
                      </button>
                      <button
                        type="button"
                        className="ghost-action-button"
                        disabled={test.status === 'testing'}
                        onClick={() => void handleProviderTest(provider)}
                      >
                        {test.status === 'testing' ? t('app.loading') : 'Test connection'}
                      </button>
                    </div>
                    {test.status !== 'idle' && (
                      <p className={`provider-test-result provider-test-${test.status}`} role={test.status === 'error' ? 'alert' : undefined}>
                        {test.message || (test.status === 'success' ? 'Connection OK' : '')}
                        {test.models && test.models.length > 0 ? ` · ${test.models.slice(0, 3).join(', ')}` : ''}
                      </p>
                    )}
                  </article>
                );
              })}
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
                {providersMeta?.localConfigPath && (
                  <button
                    type="button"
                    className="ghost-action-button"
                    onClick={() => void handleOpenConfig(providersMeta.localConfigPath!)}
                  >
                    {t('settings.config.openLocal')}
                  </button>
                )}
                {providersMeta?.configPath && (
                  <button
                    type="button"
                    className="ghost-action-button"
                    onClick={() => void handleOpenConfig(providersMeta.configPath!)}
                  >
                    {t('settings.config.openDesktop')}
                  </button>
                )}
                {userDataPath && (
                  <button
                    type="button"
                    className="ghost-action-button"
                    onClick={() => void handleOpenConfig(userDataPath)}
                  >
                    User data
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
