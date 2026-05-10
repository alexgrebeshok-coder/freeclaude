import { useEffect, useState, type ReactElement } from 'react';
import { getSingletonHighlighter, type BundledLanguage } from 'shiki/bundle/web';

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
         * Do not use the package export `codeToHtml` from `shiki/bundle/web`: it is implemented
         * via `createSingletonShorthands`, whose `get()` does
         * `themes: "theme" in options ? [options.theme] : Object.values(options.themes)`.
         * When `theme` is not an own property (or options omit it), that evaluates
         * `Object.values(undefined)` and throws "Cannot convert undefined or null to object",
         * aborting the renderer (production white screen). Calling `getSingletonHighlighter`
         * then `highlighter.codeToHtml` uses the core path and avoids that wrapper.
         */
        const lang = (language || 'text').trim() as BundledLanguage;
        const theme = resolveShikiTheme();
        const highlighter = await getSingletonHighlighter({
          themes: ['github-dark', 'github-light'],
          langs: [lang]
        });
        const out = highlighter.codeToHtml(code, { lang, theme });
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
