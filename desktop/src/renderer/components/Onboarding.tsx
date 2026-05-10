import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppTranslation } from '../hooks/useAppTranslation';

import { Icon } from './ui/Icon';

const ONBOARDING_STORAGE_KEY = 'freeclaude-onboarding-dismissed';

interface ProvidersPayload {
  configured: boolean;
  cliPath: string | null;
  configPath: string;
}

/**
 * First-run onboarding modal. Shown when:
 *   - the user has not previously dismissed onboarding, AND
 *   - either the FreeClaude CLI is not resolvable OR no providers are configured.
 *
 * Mounting it is cheap: if the conditions are not met we render `null`. The
 * caller (App.tsx) just renders <Onboarding /> next to its other top-level
 * children — this component owns its own visibility state.
 */
export function Onboarding(): React.ReactElement | null {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProvidersPayload | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dismissed = localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
        if (dismissed) return;
        const payload = (await window.electron.freeclaude.getProviders()) as ProvidersPayload;
        if (cancelled) return;
        setProviders(payload);
        if (!payload?.configured || !payload?.cliPath) {
          setOpen(true);
        }
      } catch (err) {
        console.warn('[onboarding] could not query providers:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
    } catch {
      /* ignore quota errors */
    }
    setOpen(false);
  }, []);

  const openConfig = useCallback(async () => {
    if (!providers) return;
    try {
      await window.electron.shell.openExternal(`file://${providers.configPath}`);
    } catch (err) {
      console.warn('[onboarding] open config failed:', err);
    }
  }, [providers]);

  useEffect(() => {
    if (!open || !providers) return;

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    const getFocusable = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []
    ).filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null);

    const focusInitial = window.requestAnimationFrame(() => {
      primaryActionRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusInitial);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, [dismiss, open, providers]);

  if (!open || !providers) {
    return null;
  }

  return (
    <div className="onboarding-backdrop">
      <div
        ref={dialogRef}
        className="onboarding-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-subtitle"
        tabIndex={-1}
      >
        <header className="onboarding-header">
          <h2 id="onboarding-title" className="onboarding-title">
            {t('onboarding.title')}
          </h2>
          <button
            type="button"
            className="onboarding-skip"
            onClick={dismiss}
            aria-label={t('onboarding.skip')}
          >
            <Icon name="x" size={16} />
          </button>
        </header>
        <p id="onboarding-subtitle" className="onboarding-subtitle">{t('onboarding.subtitle')}</p>
        <ol className="onboarding-steps">
          <li className="onboarding-step">
            <strong>{t('onboarding.stepInstallCli')}</strong>
            <pre className="onboarding-code">npm install -g @freeclaude/cli</pre>
          </li>
          <li className="onboarding-step">
            <strong>{t('onboarding.stepConfigure')}</strong>
            <code className="onboarding-inline-code">{providers.configPath}</code>
          </li>
          <li className="onboarding-step">
            <strong>{t('onboarding.stepStart')}</strong>
          </li>
        </ol>
        <footer className="onboarding-actions">
          <button type="button" className="onboarding-secondary" onClick={dismiss}>
            {t('onboarding.skip')}
          </button>
          <button ref={primaryActionRef} type="button" className="onboarding-primary" onClick={openConfig}>
            {t('onboarding.openConfig')}
          </button>
        </footer>
      </div>
    </div>
  );
}
