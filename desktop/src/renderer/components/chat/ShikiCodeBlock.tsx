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
        const out = await codeToHtml(code, {
          lang: language || 'text',
          theme: resolveShikiTheme()
        });
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
