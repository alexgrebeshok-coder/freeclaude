import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useAppTranslation } from '../hooks/useAppTranslation';
import { Message, ProviderInfo } from '../types';
import { Icon } from './ui/Icon';
import { MarkdownMessage } from './chat/MarkdownMessage';

interface ChatProps {
  title: string;
  messages: Message[];
  streamingMessage: string;
  isGenerating: boolean;
  draft: string;
  lastError?: string;
  onSend: (content: string) => void;
  onDraftChange: (value: string) => void;
  onCancel: () => void;
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
  onRegenerate?: () => void;
  providerId?: string;
  providerLabel?: string;
  modelLabel?: string;
  providers?: ProviderInfo[];
  onProviderChange?: (providerId: string, model?: string) => Promise<void>;
}

const EMPTY_STATE_SUGGESTIONS = [
  'Собери план реализации новой фичи',
  'Проведи аудит архитектуры текущего приложения',
  'Найди узкие места в UX и предложи улучшения'
];

function estimateTokensRough(text: string): number {
  if (!text.trim()) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

export function Chat({
  title,
  messages,
  streamingMessage,
  isGenerating,
  draft,
  lastError,
  onSend,
  onDraftChange,
  onCancel,
  composerRef,
  onRegenerate,
  providerId,
  providerLabel,
  modelLabel,
  providers = [],
  onProviderChange
}: ChatProps): React.ReactElement {
  const { t } = useAppTranslation();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastMessageCountRef = useRef(messages.length);
  const innerComposerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = composerRef ?? innerComposerRef;
  const [isDragging, setIsDragging] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isNearBottom = useCallback(() => {
    const region = scrollRegionRef.current;
    if (!region) {
      return true;
    }
    return region.scrollHeight - region.scrollTop - region.clientHeight < 160;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const region = scrollRegionRef.current;
    if (region) {
      region.scrollTo({ top: region.scrollHeight, behavior });
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const rememberScrollIntent = useCallback(() => {
    shouldAutoScrollRef.current = isNearBottom();
  }, [isNearBottom]);

  useEffect(() => {
    const messageCountChanged = lastMessageCountRef.current !== messages.length;
    lastMessageCountRef.current = messages.length;

    if (messageCountChanged) {
      scrollToBottom(streamingMessage ? 'auto' : 'smooth');
      shouldAutoScrollRef.current = true;
      return;
    }

    if (streamingMessage && shouldAutoScrollRef.current) {
      scrollToBottom('auto');
    }
  }, [messages.length, scrollToBottom, streamingMessage]);

  useEffect(() => {
    shouldAutoScrollRef.current = isNearBottom();
  }, [isNearBottom, title]);

  const providerModelLabel = providerLabel && modelLabel ? `${providerLabel} · ${modelLabel}` : null;
  const activeProvider = providers.find((provider) => provider.id === providerId);
  const modelOptions = activeProvider?.models || [];
  const modelSelectValue = modelLabel && modelOptions.includes(modelLabel) ? modelLabel : '';

  const renderAssistantPending = () => {
    if (!isGenerating || streamingMessage) {
      return null;
    }

    return (
      <article className="message-card message-card-assistant message-card-streaming message-card-pending" aria-live="polite">
        <div className="message-card-head">
          <div className="message-identity">
            <div className="message-avatar message-avatar-assistant">
              <span className="message-avatar-f">F</span>
            </div>
            <span className="message-role">FreeClaude</span>
          </div>
          <span className="streaming-indicator">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="streaming-indicator-label">{t('chat.thinking')}</span>
          </span>
        </div>
        <div className="message-card-body">
          <div className="assistant-placeholder">
            <span className="skeleton-line assistant-placeholder-line" />
            <span className="skeleton-line assistant-placeholder-line assistant-placeholder-line-short" />
          </div>
        </div>
      </article>
    );
  };

  const submitDraft = () => {
    if (!draft.trim() || isGenerating) {
      return;
    }
    onSend(draft.trim());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitDraft();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitDraft();
    }
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const copyText = useCallback(async (messageId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(messageId);
      window.setTimeout(() => setCopiedId((current) => (current === messageId ? null : current)), 1800);
    } catch {
      /* ignore */
    }
  }, []);

  const appendFilesToDraft = useCallback(
    (files: FileList | null) => {
      if (!files?.length) {
        return;
      }
      const parts: string[] = [];
      const reads: Promise<void>[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const f = files.item(i);
        if (!f) {
          continue;
        }
        if (f.size <= 120_000) {
          reads.push(
            f.text().then((t) => {
              parts.push(`### ${f.name}\n\`\`\`\n${t.slice(0, 80_000)}${f.size > 80_000 ? '\n…' : ''}\n\`\`\``);
            })
          );
        } else {
          parts.push(`(Файл слишком большой для вставки: ${f.name})`);
        }
      }
      void Promise.all(reads).then(() => {
        const block = parts.join('\n\n');
        onDraftChange(draft ? `${draft}\n\n${block}` : block);
      });
    },
    [draft, onDraftChange]
  );

  const handleDropFiles = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      appendFilesToDraft(event.dataTransfer.files);
    },
    [appendFilesToDraft]
  );

  const dropZoneHandlers: React.HTMLAttributes<HTMLFormElement> = {
    onDragEnter: (event) => {
      event.preventDefault();
      setIsDragging(true);
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) {
        setIsDragging(false);
      }
    },
    onDragOver: (event) => {
      event.preventDefault();
    },
    onDrop: handleDropFiles
  };

  const tokenHint = estimateTokensRough(draft);

  return (
    <div className="chat-workspace">
      <div className="chat-scroll-region" ref={scrollRegionRef} onScroll={rememberScrollIntent}>
        <div className="conversation-lane">
          <header className="conversation-header-card">
            <div>
              <span className="conversation-kicker">Активная сессия</span>
              <h2 className="conversation-title">{title}</h2>
            </div>
            <div className="conversation-badges">
              <span className="conversation-badge">
                <Icon name="chat" size={14} />
                <span>{messages.length} сообщений</span>
              </span>
              {isGenerating && (
                <span className="conversation-badge conversation-badge-live">
                  <span className="topbar-status-dot" />
                  <span>Стриминг ответа</span>
                </span>
              )}
            </div>
          </header>

          {lastError && (
            <div className="conversation-alert" role="alert">
              <span>{lastError}</span>
            </div>
          )}

          {messages.length === 0 && !streamingMessage && !isGenerating && (
            <div className="conversation-empty-card">
              <div className="conversation-empty-copy">
                <span className="conversation-kicker">Новая ветка диалога</span>
                <h3>Начните разговор с полноценным контекстом</h3>
                <p>Composer и весь чат уже готовы: можно отправить промпт, открыть терминал, проверить файлы или перейти к настройкам провайдера.</p>
              </div>
              <div className="conversation-empty-actions">
                {EMPTY_STATE_SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} className="ghost-action-button" onClick={() => onSend(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <article
              key={message.id}
              className={`message-card message-card-${message.role}`}
            >
              <div className="message-card-head">
                <div className="message-identity">
                  <div className={`message-avatar message-avatar-${message.role}`}>
                    {message.role === 'user' ? (
                      <span>Вы</span>
                    ) : (
                      <span className="message-avatar-f">F</span>
                    )}
                  </div>
                  <span className="message-role">
                    {message.role === 'user' ? 'Вы' : message.role === 'assistant' ? 'FreeClaude' : 'Система'}
                  </span>
                </div>
                <span className="message-time">{formatTime(message.timestamp)}</span>
              </div>
              <div className="message-card-body">
                {message.role === 'assistant' ? (
                  <MarkdownMessage content={message.content} />
                ) : (
                  <div className="message-plain">{message.content}</div>
                )}
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="tool-stack">
                    {message.toolCalls.map((tool) => (
                      <div key={tool.id} className="tool-card">
                        <div className="tool-card-header">
                          <Icon name="sparkles" size={14} />
                          <span className="tool-name">{tool.name}</span>
                        </div>
                        <div className="tool-card-input">
                          <code>{JSON.stringify(tool.input, null, 2)}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="message-actions">
                <button
                  type="button"
                  className={`message-action-btn ${copiedId === message.id ? 'is-success' : ''}`}
                  title={copiedId === message.id ? t('chat.copied') : t('app.copy')}
                  aria-label={copiedId === message.id ? t('chat.copied') : t('chat.copyMessage')}
                  onClick={() => copyText(message.id, message.content)}
                >
                  <Icon name="copy" size={14} />
                </button>
                {copiedId === message.id && <span className="message-action-status">{t('chat.copied')}</span>}
                {message.role === 'assistant' && index === messages.length - 1 && onRegenerate && (
                  <button
                    type="button"
                    className="message-action-btn"
                    title={t('chat.regenerate')}
                    aria-label={t('chat.regenerate')}
                    onClick={onRegenerate}
                  >
                    <Icon name="refresh" size={14} />
                  </button>
                )}
              </div>
            </article>
          ))}

          {renderAssistantPending()}

          {streamingMessage && (
            <article className="message-card message-card-assistant message-card-streaming">
              <div className="message-card-head">
                <div className="message-identity">
                  <div className="message-avatar message-avatar-assistant">
                    <span className="message-avatar-f">F</span>
                  </div>
                  <span className="message-role">FreeClaude</span>
                </div>
                <span className="streaming-indicator" aria-live="polite">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="streaming-indicator-label">Печатает…</span>
                </span>
              </div>
              <div className="message-card-body">
                <MarkdownMessage content={streamingMessage} />
              </div>
            </article>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="chat-composer-dock">
        <form
          onSubmit={handleSubmit}
          className={`chat-composer-card ${isDragging ? 'is-dragging' : ''}`}
          {...dropZoneHandlers}
        >
          <div className="chat-composer-header">
            <span className="chat-composer-caption">{t('chat.composer.continue')}</span>
            <span className="chat-composer-meta">
              {isGenerating ? t('chat.composer.stopHint') : t('chat.composer.keyboardHint')}
            </span>
          </div>
          <div className="chat-composer-body">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.composer.placeholder')}
              aria-label={t('chat.composer.ariaLabel')}
              rows={3}
              disabled={isGenerating}
              className="composer-input composer-input-chat"
            />
            {isGenerating ? (
              <button type="button" className="composer-send composer-send-cancel" aria-label={t('chat.stop')} onClick={onCancel}>
                <Icon name="stop" size={15} />
              </button>
            ) : (
              <button type="submit" className="composer-send" aria-label={t('chat.send')} disabled={!draft.trim()}>
                <Icon name="arrow-up" size={16} />
              </button>
            )}
          </div>
          <div className="chat-composer-footer">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                appendFilesToDraft(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              className="composer-tool-pill"
              onClick={() => fileInputRef.current?.click()}
              disabled={isGenerating}
              aria-label={t('chat.composer.attachFile')}
            >
              <Icon name="file" size={14} />
              <span>{t('chat.composer.attachFile')}</span>
            </button>
            <div className="chat-composer-footer-meta">
              {providers.length > 0 && onProviderChange && (
                <div className="composer-provider-switcher" title={t('chat.composer.providerModelTitle')}>
                  <select
                    aria-label="Provider"
                    value={activeProvider?.id || providers[0]?.id || ''}
                    onChange={(event) => {
                      const next = providers.find((provider) => provider.id === event.target.value);
                      void onProviderChange(event.target.value, next?.defaultModel || next?.models[0]);
                    }}
                    disabled={isGenerating}
                  >
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.short}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Model"
                    value={modelSelectValue}
                    onChange={(event) => {
                      const provider = activeProvider || providers[0];
                      if (provider) void onProviderChange(provider.id, event.target.value);
                    }}
                    disabled={isGenerating || !activeProvider || modelOptions.length === 0}
                  >
                    {modelSelectValue === '' && (
                      <option value="">
                        {modelLabel || 'Model'}
                      </option>
                    )}
                    {modelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {providerModelLabel && (
                <span className="composer-model-chip" title={t('chat.composer.providerModelTitle')}>
                  {providerModelLabel}
                </span>
              )}
              <span className="token-estimate">{t('chat.composer.tokenEstimate', { count: tokenHint })}</span>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
