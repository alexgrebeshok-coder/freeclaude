import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useAppTranslation } from '../../hooks/useAppTranslation';
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
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
}

function greetingLine(displayName: string): string {
  const h = new Date().getHours();
  let part = 'Добрый вечер';
  if (h >= 5 && h < 12) {
    part = 'Доброе утро';
  } else if (h >= 12 && h < 18) {
    part = 'Добрый день';
  }
  return `${part}, ${displayName}`;
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
  suggestions,
  composerRef
}: HomeCanvasProps): React.ReactElement {
  const { t } = useAppTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const innerRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = composerRef ?? innerRef;
  const [isDragging, setIsDragging] = useState(false);

  const welcome = useMemo(() => greetingLine('Саша'), []);

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

  return (
    <section className="home-canvas relative min-h-0 flex-1 overflow-y-auto">
      <div className="home-canvas-inner home-canvas-cursor mx-auto flex max-w-[640px] flex-col gap-7 px-6 py-8 md:py-10">
        <header className="home-cursor-header flex flex-col items-center text-center">
          <span className="sr-only">{welcome}</span>
          <h2 className="home-cursor-title font-sans text-[1.375rem] font-semibold leading-snug tracking-tight text-app-strong md:text-[1.5rem]">
            {heading}
          </h2>
          {subheading ? (
            <p className="home-cursor-sub mt-2 max-w-[480px] text-sm leading-relaxed text-app-mutedText">{subheading}</p>
          ) : null}
        </header>

        <form
          className="home-cursor-form flex flex-col gap-2"
          onSubmit={handleSubmit}
          {...dropZoneHandlers}
        >
          <div className={`home-composer-cursor ${isDragging ? 'is-dragging' : ''}`}>
            <textarea
              ref={textareaRef}
              className="composer-input home-composer-input home-composer-input-cursor"
              rows={4}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={t('chat.homeComposer.placeholder')}
              aria-label={t('chat.homeComposer.ariaLabel')}
              disabled={isGenerating}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitDraft();
                }
              }}
            />

            <div className="home-composer-toolbar">
              <div className="home-composer-toolbar-left">
                <button
                  type="button"
                  className="composer-tool-icon"
                  aria-label={t('chat.composer.attachFile')}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isGenerating}
                >
                  <Icon name="plus" size={18} />
                </button>
                <span className="composer-access-chip" title={t('chat.homeComposer.localTitle')}>
                  {t('chat.homeComposer.localMode')}
                </span>
              </div>

              <div className="home-composer-toolbar-right">
                <span className="composer-model-chip" title={t('chat.composer.providerModelTitle')}>
                  {providerLabel} · {modelLabel}
                </span>
                {isGenerating ? (
                  <button type="button" className="composer-send composer-send-round composer-send-cancel" aria-label={t('chat.stop')} onClick={onCancel}>
                    <Icon name="stop" size={15} />
                  </button>
                ) : (
                  <button type="submit" className="composer-send composer-send-round" aria-label={t('chat.send')} disabled={!draft.trim()}>
                    <Icon name="arrow-up" size={16} />
                  </button>
                )}
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                appendFilesToDraft(event.target.files);
                event.target.value = '';
              }}
            />
          </div>

          <div className="home-context-row-cursor" role="group" aria-label="Контекст запроса">
            <span className="context-chip-minimal">
              <Icon name="folder" size={14} />
              <span>{projectLabel}</span>
              <Icon name="chevron-down" size={12} aria-hidden />
            </span>
            <span className="context-chip-minimal">
              <Icon name="terminal" size={14} />
              <span>Работать локально</span>
              <Icon name="chevron-down" size={12} aria-hidden />
            </span>
            <span className="context-chip-minimal">
              <Icon name="plug" size={14} />
              <span>{`${providerLabel} · ${modelLabel}`}</span>
              <Icon name="chevron-down" size={12} aria-hidden />
            </span>
          </div>

          <p className="home-composer-kbd-hint text-center text-[11px] text-app-mutedText">
            <kbd>Cmd</kbd> + <kbd>K</kbd> — фокус в поле ввода
          </p>
        </form>

        <div className="home-suggestions-cursor">
          <ul className="home-suggestion-list-cursor">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <button type="button" className="home-suggestion-line" onClick={() => onSend(suggestion.prompt)}>
                  <Icon name="chat" size={15} className="home-suggestion-line-icon" />
                  <span className="home-suggestion-line-title">{suggestion.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
