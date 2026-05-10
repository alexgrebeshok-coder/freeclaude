import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppConfig, ChatSession, ProviderInfo } from '../../types';
import { Icon } from '../ui/Icon';

function estimateSessionTokens(chat: ChatSession | null, locale: string): { approx: number; label: string } {
  if (!chat) {
    return { approx: 0, label: '—' };
  }
  const text = [
    ...chat.messages.map((m) => m.content),
    chat.streamingMessage,
    chat.draft
  ].join('\n');
  if (!text.trim()) {
    return { approx: 0, label: '—' };
  }
  const approx = Math.max(1, Math.ceil(text.length / 4));
  return { approx, label: `≈ ${approx.toLocaleString(locale)}` };
}

function formatCostHint(tokens: number, provider?: ProviderInfo): string {
  if (tokens <= 0 || !provider?.price) {
    return '—';
  }
  const inputTokens = Math.ceil(tokens * 0.65);
  const outputTokens = Math.ceil(tokens * 0.35);
  const cost =
    (inputTokens / 1_000_000) * provider.price.inputPerMillion +
    (outputTokens / 1_000_000) * provider.price.outputPerMillion;
  return `≈ ${cost < 0.0001 ? '<0.0001' : cost.toFixed(4)} USD`;
}

function sessionDurationMs(chat: ChatSession | null, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!chat || chat.messages.length === 0) {
    return '—';
  }
  const first = chat.messages[0]?.timestamp;
  const last = chat.updatedAt;
  const ms = Math.max(0, last - first);
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  if (min > 120) {
    return t('inspector.duration.hours', { count: Math.floor(min / 60) });
  }
  if (min > 0) {
    return t('inspector.duration.minutes', { count: min });
  }
  return t('inspector.duration.seconds', { count: sec });
}

interface InspectorPanelProps {
  open: boolean;
  compact: boolean;
  config: AppConfig;
  provider?: ProviderInfo;
  activeChat: ChatSession | null;
  /**
   * CLI diagnostics surfaced from `freeclaude:message` events with
   * `type: 'diagnostic' | 'warning'`. They never appear in the chat stream;
   * they live here for triage. Up to ~50 most recent lines per chat.
   */
  diagnostics?: string[];
  onClose: () => void;
  onToggleCompact: () => void;
  onClearChat: () => void;
  onExportMarkdown: () => void;
  onRenameChat: (chatId: string, title: string) => void;
}

export function InspectorPanel({
  open,
  compact,
  config,
  provider,
  activeChat,
  diagnostics,
  onClose,
  onToggleCompact,
  onClearChat,
  onExportMarkdown,
  onRenameChat
}: InspectorPanelProps): React.ReactElement {
  const { i18n, t } = useTranslation();
  const tokenInfo = useMemo(() => estimateSessionTokens(activeChat, i18n.language), [activeChat, i18n.language]);
  const durationLabel = useMemo(() => sessionDurationMs(activeChat, t), [activeChat, t]);
  const [titleDraft, setTitleDraft] = useState(activeChat?.title ?? '');

  useEffect(() => {
    setTitleDraft(activeChat?.title ?? '');
  }, [activeChat?.id, activeChat?.title]);

  const submitTitle = (event: React.FormEvent) => {
    event.preventDefault();
    const nextTitle = titleDraft.trim();
    if (activeChat && nextTitle && nextTitle !== activeChat.title) {
      onRenameChat(activeChat.id, nextTitle);
    }
  };

  return (
    <aside
      className={`inspector-panel ${open ? 'is-open' : ''} ${compact ? 'is-compact' : ''}`}
      // `inert` (React 19+) makes the entire subtree unfocusable AND hidden from
      // assistive tech when the panel is closed, while still letting CSS animate
      // the slide-out. We keep aria-hidden as a belt-and-braces fallback for
      // user agents that haven't shipped inert yet.
      inert={!open}
      aria-hidden={!open}
    >
      <div className="inspector-panel-inner">
        <header className="inspector-header">
          <h2 className="inspector-title">{t('inspector.title')}</h2>
          <div className="inspector-header-actions">
            <button
              type="button"
              className="inspector-icon-btn"
              title={t('inspector.compactMode')}
              aria-label={t('inspector.toggleCompact')}
              onClick={onToggleCompact}
            >
              <Icon name="sliders" size={16} />
            </button>
            <button type="button" className="inspector-icon-btn" title={t('app.close')} aria-label={t('inspector.close')} onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </div>
        </header>

        <section className="inspector-section">
          <h3 className="inspector-section-title">{t('inspector.sections.context')}</h3>
          <dl className="inspector-kv">
            <div>
              <dt>{t('inspector.model')}</dt>
              <dd>{config.model}</dd>
            </div>
            <div>
              <dt>{t('inspector.provider')}</dt>
              <dd>{provider?.short || config.provider.toUpperCase()}</dd>
            </div>
            <div>
              <dt>{t('inspector.tokens')}</dt>
              <dd>{tokenInfo.label}</dd>
            </div>
            <div>
              <dt>{t('inspector.cost')}</dt>
              <dd className="inspector-hint">{formatCostHint(tokenInfo.approx, provider)} · {t('inspector.estimate')}</dd>
            </div>
          </dl>
        </section>

        <section className="inspector-section">
          <h3 className="inspector-section-title">{t('inspector.sections.session')}</h3>
          <form className="inspector-title-form" onSubmit={submitTitle}>
            <label htmlFor="inspector-chat-title">{t('inspector.chatTitle')}</label>
            <div className="inspector-title-row">
              <input
                id="inspector-chat-title"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                placeholder={t('inspector.selectChat')}
                disabled={!activeChat}
              />
              <button type="submit" className="inspector-action inspector-action-compact" disabled={!activeChat || !titleDraft.trim()}>
                {t('app.save')}
              </button>
            </div>
          </form>
          <dl className="inspector-kv">
            <div>
              <dt>ID</dt>
              <dd className="inspector-mono">{activeChat?.id ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('inspector.duration.label')}</dt>
              <dd>{durationLabel}</dd>
            </div>
            <div>
              <dt>{t('inspector.messages')}</dt>
              <dd>{activeChat ? activeChat.messages.length : '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="inspector-section">
          <h3 className="inspector-section-title">{t('inspector.sections.actions')}</h3>
          <div className="inspector-actions">
            <button type="button" className="inspector-action" onClick={onClearChat} disabled={!activeChat}>
              <Icon name="trash" size={16} />
              <span>{t('inspector.clearChat')}</span>
            </button>
            <button type="button" className="inspector-action" onClick={onExportMarkdown} disabled={!activeChat}>
              <Icon name="download" size={16} />
              <span>{t('inspector.exportMarkdown')}</span>
            </button>
            <button
              type="button"
              className="inspector-action"
              onClick={() => activeChat && navigator.clipboard.writeText(activeChat.id)}
              disabled={!activeChat}
            >
              <Icon name="copy" size={16} />
              <span>{t('inspector.copySessionId')}</span>
            </button>
          </div>
        </section>

        {diagnostics && diagnostics.length > 0 ? (
          <section className="inspector-section">
            <h3 className="inspector-section-title">{t('inspector.sections.diagnostics')}</h3>
            <ul className="inspector-diagnostics" aria-live="polite">
              {diagnostics.slice(-50).map((line, idx) => (
                <li key={`${idx}-${line.slice(0, 16)}`} className="inspector-diagnostic-line">
                  {line}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
