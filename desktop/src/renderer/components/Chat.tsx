import React, { useRef, useEffect } from 'react';
import { Message } from '../types';
import { Icon } from './ui/Icon';

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
}

const EMPTY_STATE_SUGGESTIONS = [
  'Собери план реализации новой фичи',
  'Проведи аудит архитектуры текущего приложения',
  'Найди узкие места в UX и предложи улучшения'
];

export function Chat({
  title,
  messages,
  streamingMessage,
  isGenerating,
  draft,
  lastError,
  onSend,
  onDraftChange,
  onCancel
}: ChatProps): React.ReactElement {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingMessage]);

  const submitDraft = () => {
    if (!draft.trim() || isGenerating) return;
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

  return (
    <div className="chat-workspace">
      <div className="chat-scroll-region">
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
            <div className="conversation-alert">
              <span>{lastError}</span>
            </div>
          )}

          {messages.length === 0 && !streamingMessage && (
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

          {messages.map(message => (
            <article key={message.id} className={`message-card message-card-${message.role}`}>
              <div className="message-card-head">
                <span className="message-role">
                  {message.role === 'user' ? 'Вы' : message.role === 'assistant' ? 'FreeClaude' : 'Система'}
                </span>
                <span className="message-time">{formatTime(message.timestamp)}</span>
              </div>
              <div className="message-card-body">
                <pre className="message-text">{message.content}</pre>
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="tool-stack">
                    {message.toolCalls.map(tool => (
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
            </article>
          ))}

          {streamingMessage && (
            <article className="message-card message-card-assistant message-card-streaming">
              <div className="message-card-head">
                <span className="message-role">FreeClaude</span>
                <span className="streaming-indicator">Генерирует ответ…</span>
              </div>
              <div className="message-card-body">
                <pre className="message-text">{streamingMessage}</pre>
              </div>
            </article>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="chat-composer-dock">
        <form onSubmit={handleSubmit} className="chat-composer-card">
          <div className="chat-composer-header">
            <span className="chat-composer-caption">Продолжить работу</span>
            <span className="chat-composer-meta">{isGenerating ? 'Можно остановить ответ' : 'Enter — отправить, Shift+Enter — новая строка'}</span>
          </div>
          <div className="chat-composer-body">
            <textarea
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Продолжите диалог, опишите задачу, добавьте ограничения или попросите план."
              rows={3}
              disabled={isGenerating}
              className="composer-input composer-input-chat"
            />
            {isGenerating ? (
              <button
                type="button"
                className="composer-send composer-send-cancel"
                onClick={onCancel}
              >
                <Icon name="stop" size={15} />
              </button>
            ) : (
              <button
                type="submit"
                className="composer-send"
                disabled={!draft.trim()}
              >
                <Icon name="arrow-up" size={16} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
