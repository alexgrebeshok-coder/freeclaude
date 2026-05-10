import { useEffect, useState, type ReactElement } from 'react';
import { codeToHtml } from 'shiki/bundle/web';

function resolveShikiTheme(): 'github-dark' | 'github-light' {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') {
    return 'github-dark';
  }
  if (t === 'light') {
    return 'github-light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'github-dark' : 'github-light';
}

export function ShikiCodeBlock({
  code,
  language
}: {
  code: string;
  language: string;
}): ReactElement {
  const [html, setHtml] = useState<string>('');
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => {
    const obs = new MutationObserver(() => setThemeKey((k) => k + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        /**
         * @shikijs/core `codeToTokens` branches on `"themes" in options` and then runs
         * `Object.entries(options.themes)`. If `themes` is present but nullish (including via
         * a polluted prototype chain), V8 throws exactly: "Cannot convert undefined or null to object".
         * Build options from a null prototype and never carry a nullish `themes` key.
         */
        const opts = Object.assign(Object.create(null), {
          lang: language || 'text',
          theme: resolveShikiTheme()
        }) as Parameters<typeof codeToHtml>[1];
        if ('themes' in opts) {
          delete (opts as { themes?: unknown }).themes;
        }
        const out = await codeToHtml(code, opts);
        if (!cancelled) {
          setHtml(out);
        }
      } catch {
        if (!cancelled) {
          setHtml('');
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [code, language, themeKey]);

  if (!html) {
    return (
      <pre className="message-code-fallback">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div className="message-shiki" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
