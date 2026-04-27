import React from 'react';
import { Icon } from '../ui/Icon';

export interface HomeSuggestion {
  id: string;
  title: string;
  description: string;
  prompt: string;
}

interface HomeCanvasProps {
  heading: string;
  subheading: string;
  draft: string;
  isGenerating: boolean;
  projectLabel: string;
  providerLabel: string;
  modelLabel: string;
  onDraftChange: (value: string) => void;
  onSend: (value: string) => void;
  onCancel: () => void;
  suggestions: HomeSuggestion[];
}

export function HomeCanvas({
  heading,
  subheading,
  draft,
  isGenerating,
  projectLabel,
  providerLabel,
  modelLabel,
  onDraftChange,
  onSend,
  onCancel,
  suggestions
}: HomeCanvasProps): React.ReactElement {
  const submitDraft = () => {
    const content = draft.trim();
    if (!content || isGenerating) {
      return;
    }
    onSend(content);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    submitDraft();
  };

  return (
    <section className="home-canvas">
      <div className="home-canvas-inner">
        <div className="home-hero">
          <span className="home-eyebrow">Premium workspace for coding flows</span>
          <h2 className="home-title">{heading}</h2>
          <p className="home-subtitle">{subheading}</p>
        </div>

        <form className="composer-card" onSubmit={handleSubmit}>
          <div className="composer-card-head">
            <div className="composer-chip-row">
              <span className="context-chip">
                <Icon name="folder" size={14} />
                <span>{projectLabel}</span>
              </span>
              <span className="context-chip">
                <Icon name="terminal" size={14} />
                <span>Работать локально</span>
              </span>
              <span className="context-chip">
                <Icon name="plug" size={14} />
                <span>{providerLabel}</span>
              </span>
              <span className="context-chip">
                <Icon name="sparkles" size={14} />
                <span>{modelLabel}</span>
              </span>
            </div>
          </div>

          <textarea
            className="composer-input"
            rows={3}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Спросите FreeClaude о чём угодно. Используйте @ для контекста, файлов и рабочих режимов."
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submitDraft();
              }
            }}
          />

          <div className="composer-toolbar">
            <div className="composer-toolbar-left">
              <button type="button" className="composer-tool-button">
                <Icon name="plus" size={16} />
              </button>
              <button type="button" className="composer-tool-pill">
                <Icon name="sliders" size={14} />
                <span>Разрешения по умолчанию</span>
                <Icon name="chevron-down" size={14} />
              </button>
            </div>

            <div className="composer-toolbar-right">
              <span className="composer-meta">{isGenerating ? 'Идёт генерация…' : 'Готово к работе'}</span>
              {isGenerating ? (
                <button type="button" className="composer-send composer-send-cancel" onClick={onCancel}>
                  <Icon name="stop" size={15} />
                </button>
              ) : (
                <button type="submit" className="composer-send" disabled={!draft.trim()}>
                  <Icon name="arrow-up" size={16} />
                </button>
              )}
            </div>
          </div>
        </form>

        <div className="suggestion-grid">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              className="suggestion-card"
              onClick={() => onSend(suggestion.prompt)}
            >
              <div className="suggestion-card-icon">
                <Icon name="sparkles" size={16} />
              </div>
              <div className="suggestion-card-copy">
                <span className="suggestion-card-title">{suggestion.title}</span>
                <span className="suggestion-card-description">{suggestion.description}</span>
              </div>
              <Icon name="chevron-right" size={16} className="suggestion-card-arrow" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
