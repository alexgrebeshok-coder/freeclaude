import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppTranslation } from '../hooks/useAppTranslation';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface TerminalProps {
  isVisible: boolean;
  cwd?: string;
}

interface SessionData {
  tabId: string;
  label: string;
  ptyId: string | null;
  terminal: XTerm;
  fitAddon: FitAddon;
  isReady: boolean;
  hasExited: boolean;
  unsubData: (() => void) | null;
  unsubExit: (() => void) | null;
}

// Tab UI state (plain values, safe to keep in React state)
interface TabInfo {
  tabId: string;
  label: string;
  isReady: boolean;
  hasExited: boolean;
}

// ── Theme helpers ──────────────────────────────────────────────────────────

function detectThemeMode(): 'light' | 'dark' {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'light') return 'light';
  if (attr === 'dark') return 'dark';
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

function buildXtermTheme(mode: 'light' | 'dark'): Record<string, string> {
  // Keep the terminal synchronized with the app theme tokens in both light and dark modes.
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const isDark = mode === 'dark';

  return {
    background: v('--color-canvas-muted', isDark ? '#0c1222' : '#f8fafc'),
    foreground: v('--color-text-strong', isDark ? '#f8fafc' : '#0f172a'),
    cursor: v('--color-text-strong', isDark ? '#f8fafc' : '#0f172a'),
    selectionBackground: v('--color-accent-ring', isDark ? 'rgba(59,130,246,0.35)' : 'rgba(37,99,235,0.28)'),
    black: v('--color-canvas', isDark ? '#0f172a' : '#ffffff'),
    red: v('--color-danger', '#ef4444'),
    green: v('--color-success', '#22c55e'),
    yellow: v('--color-warning', '#f59e0b'),
    blue: v('--color-accent', isDark ? '#3b82f6' : '#2563eb'),
    magenta: isDark ? '#c084fc' : '#9333ea',
    cyan: v('--color-info', isDark ? '#60a5fa' : '#3b82f6'),
    white: v('--color-text', isDark ? '#cbd5e1' : '#475569'),
    brightBlack: v('--color-text-soft', isDark ? '#64748b' : '#8492a6'),
    brightRed: v('--color-danger', '#ef4444'),
    brightGreen: v('--color-success', '#22c55e'),
    brightYellow: v('--color-warning', '#f59e0b'),
    brightBlue: v('--color-accent-hover', isDark ? '#2563eb' : '#1d4ed8'),
    brightMagenta: isDark ? '#d8b4fe' : '#a855f7',
    brightCyan: v('--color-info', isDark ? '#60a5fa' : '#3b82f6'),
    brightWhite: v('--color-text-strong', isDark ? '#f8fafc' : '#0f172a'),
  };
}

// Monotonic counter for generating stable tab IDs across remounts
let tabSerial = 0;

export function Terminal({ isVisible, cwd }: TerminalProps): React.ReactElement {
  const { t } = useAppTranslation();
  // #region agent log
  fetch('http://127.0.0.1:7483/ingest/cd715575-ed80-4222-acf6-07a333a1474f', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '87012e' },
    body: JSON.stringify({
      sessionId: '87012e',
      runId: 'pre-fix',
      hypothesisId: 'H1',
      location: 'Terminal.tsx:render',
      message: 'Terminal render entry',
      data: { hasElectron: typeof window !== 'undefined' && !!window.electron },
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
  const shortcutModifier = window.electron.platform === 'darwin' ? '⌘' : 'Ctrl+';

  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Mutable session storage — not React state so mutations don't trigger renders
  const sessionsRef = useRef<Map<string, SessionData>>(new Map());
  // Track which container divs have already had terminal.open() called
  const mountedContainersRef = useRef<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const homeDirRef = useRef<string | null>(null);

  // Push the current session map into React tab state
  const syncTabs = useCallback(() => {
    setTabs(
      Array.from(sessionsRef.current.values()).map((s) => ({
        tabId: s.tabId,
        label: s.label,
        isReady: s.isReady,
        hasExited: s.hasExited,
      }))
    );
  }, []);

  // ── PTY lifecycle helpers ────────────────────────────────────────────────

  const resolveHomeCwd = useCallback(async (): Promise<string> => {
    if (cwd) return cwd;
    if (homeDirRef.current) return homeDirRef.current;
    try {
      const h = (await window.electron.paths.home()) as string | undefined;
      homeDirRef.current = h || '/';
    } catch {
      homeDirRef.current = '/';
    }
    return homeDirRef.current;
  }, [cwd]);

  /**
   * Create a PTY for an already-opened xterm instance and wire IPC listeners.
   * Safe to call on first mount AND on restart (after clearing old subs).
   */
  const startPty = useCallback(
    async (session: SessionData) => {
      if (window.electron.platform === 'browser') {
        session.terminal.writeln(t('terminal.preview'));
        session.hasExited = true;
        syncTabs();
        return;
      }

      const sessionCwd = await resolveHomeCwd();
      const cols = session.terminal.cols > 0 ? session.terminal.cols : 80;
      const rows = session.terminal.rows > 0 ? session.terminal.rows : 24;

      const ptyId = (await window.electron.terminal.create({
        cols,
        rows,
        cwd: sessionCwd,
      })) as string;

      session.ptyId = ptyId;
      session.isReady = true;
      session.hasExited = false;

      session.unsubData = window.electron.terminal.onData((id: string, data: string) => {
        if (id === session.ptyId) session.terminal.write(data);
      });

      session.unsubExit = window.electron.terminal.onExit((id: string, code: number) => {
        if (id === session.ptyId) {
          session.ptyId = null;
          session.isReady = false;
          session.hasExited = true;
          session.terminal.writeln(`\r\n${t('terminal.exit', { code })}`);
          syncTabs();
        }
      });
    },
    [resolveHomeCwd, t, syncTabs]
  );

  // ── Tab management ───────────────────────────────────────────────────────

  const createTab = useCallback(async () => {
    tabSerial += 1;
    const tabId = `tab-${tabSerial}`;
    const label = `${t('terminal.tab')} ${tabSerial}`;

    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: buildXtermTheme(detectThemeMode()),
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Wire xterm input → PTY (once per xterm instance; these fire regardless of
    // active tab so we guard by checking ptyId at call time)
    terminal.onData((data) => {
      const s = sessionsRef.current.get(tabId);
      if (s?.ptyId) void window.electron.terminal.write(s.ptyId, data);
    });
    terminal.onResize(({ cols, rows }) => {
      const s = sessionsRef.current.get(tabId);
      if (s?.ptyId) void window.electron.terminal.resize(s.ptyId, cols, rows);
    });

    const session: SessionData = {
      tabId,
      label,
      ptyId: null,
      terminal,
      fitAddon,
      isReady: false,
      hasExited: false,
      unsubData: null,
      unsubExit: null,
    };

    sessionsRef.current.set(tabId, session);
    setActiveTabId(tabId);
    syncTabs();
    return tabId;
  }, [t, syncTabs]);

  const closeTab = useCallback(
    (tabId: string) => {
      const session = sessionsRef.current.get(tabId);
      if (session) {
        if (session.ptyId) void window.electron.terminal.kill(session.ptyId);
        session.unsubData?.();
        session.unsubExit?.();
        session.terminal.dispose();
        sessionsRef.current.delete(tabId);
        mountedContainersRef.current.delete(tabId);
      }

      setActiveTabId((prev) => {
        if (prev !== tabId) return prev;
        const remaining = Array.from(sessionsRef.current.keys());
        return remaining.length > 0 ? remaining[remaining.length - 1] : null;
      });
      syncTabs();
    },
    [syncTabs]
  );

  const restartSession = useCallback(
    async (tabId: string) => {
      const session = sessionsRef.current.get(tabId);
      if (!session || session.isReady) return;

      session.unsubData?.();
      session.unsubExit?.();
      session.unsubData = null;
      session.unsubExit = null;
      session.ptyId = null;
      session.hasExited = false;

      session.terminal.clear();

      await startPty(session);
      syncTabs();
    },
    [startPty, syncTabs]
  );

  const selectTab = useCallback((tabId: string, shouldFocus = false) => {
    setActiveTabId(tabId);
    if (shouldFocus) {
      requestAnimationFrame(() => tabButtonRefs.current.get(tabId)?.focus());
    }
  }, []);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, tabId: string) => {
      const ids = tabs.map((tab) => tab.tabId);
      const currentIdx = ids.indexOf(tabId);
      if (currentIdx === -1) return;

      let nextIdx: number | null = null;
      switch (e.key) {
        case 'ArrowRight':
          nextIdx = (currentIdx + 1) % ids.length;
          break;
        case 'ArrowLeft':
          nextIdx = (currentIdx - 1 + ids.length) % ids.length;
          break;
        case 'Home':
          nextIdx = 0;
          break;
        case 'End':
          nextIdx = ids.length - 1;
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          selectTab(tabId);
          return;
        default:
          return;
      }

      e.preventDefault();
      selectTab(ids[nextIdx], true);
    },
    [tabs, selectTab]
  );

  // ── Container ref callback ───────────────────────────────────────────────

  // Called by React after a new tab's container div mounts in the DOM.
  const handleContainerMount = useCallback(
    (tabId: string, el: HTMLDivElement | null) => {
      if (!el || mountedContainersRef.current.has(tabId)) return;
      mountedContainersRef.current.add(tabId);

      const session = sessionsRef.current.get(tabId);
      if (!session) return;

      session.terminal.open(el);
      try {
        session.fitAddon.fit();
      } catch {
        // Ignore fit errors while container is hidden
      }

      void startPty(session).then(() => syncTabs());
    },
    [startPty, syncTabs]
  );

  // ── Fit / resize effects ─────────────────────────────────────────────────

  // Re-fit active terminal when the panel becomes visible or the active tab changes
  useEffect(() => {
    if (!isVisible || !activeTabId) return;

    const frame1 = requestAnimationFrame(() => {
      const frame2 = requestAnimationFrame(() => {
        const session = sessionsRef.current.get(activeTabId);
        if (!session) return;
        try {
          session.fitAddon.fit();
        } catch {
          // Ignore hidden-container failures
        }
        if (session.ptyId) {
          const cols = session.terminal.cols > 0 ? session.terminal.cols : 80;
          const rows = session.terminal.rows > 0 ? session.terminal.rows : 24;
          void window.electron.terminal.resize(session.ptyId, cols, rows);
        }
      });
      return () => cancelAnimationFrame(frame2);
    });
    return () => cancelAnimationFrame(frame1);
  }, [isVisible, activeTabId]);

  // Re-fit on window resize
  useEffect(() => {
    const handleResize = () => {
      if (!activeTabId) return;
      const session = sessionsRef.current.get(activeTabId);
      if (!session) return;
      try {
        session.fitAddon.fit();
      } catch {
        // ignore
      }
      if (session.ptyId) {
        const cols = session.terminal.cols > 0 ? session.terminal.cols : 80;
        const rows = session.terminal.rows > 0 ? session.terminal.rows : 24;
        void window.electron.terminal.resize(session.ptyId, cols, rows);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeTabId]);

  // ── Theme observer ───────────────────────────────────────────────────────

  useEffect(() => {
    const applyTheme = () => {
      const theme = buildXtermTheme(detectThemeMode());
      sessionsRef.current.forEach((s) => {
        s.terminal.options.theme = theme;
      });
    };

    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    // Also respond to OS-level prefers-color-scheme when app theme is 'auto'
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const handleMQ = () => {
      const attr = document.documentElement.dataset.theme;
      if (!attr || attr === 'auto') applyTheme();
    };
    mq?.addEventListener('change', handleMQ);

    return () => {
      observer.disconnect();
      mq?.removeEventListener('change', handleMQ);
    };
  }, []);

  // ── Keyboard shortcuts (scoped to this panel) ────────────────────────────

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === 't') {
        e.preventDefault();
        void createTab();
        return;
      }

      if (e.key === 'w') {
        e.preventDefault();
        setActiveTabId((current) => {
          if (current) closeTab(current);
          return current; // closeTab handles the switch
        });
        return;
      }

      const digit = parseInt(e.key, 10);
      if (digit >= 1 && digit <= 9) {
        const ids = Array.from(sessionsRef.current.keys());
        if (ids[digit - 1]) {
          e.preventDefault();
          setActiveTabId(ids[digit - 1]);
        }
      }
    };

    panel.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => panel.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [createTab, closeTab]);

  // ── Full cleanup on unmount ──────────────────────────────────────────────

  useEffect(() => {
    // Capture the map reference at effect-creation time so the cleanup
    // function closes over a stable value (satisfies react-hooks/exhaustive-deps).
    const sessions = sessionsRef.current;
    return () => {
      sessions.forEach((s) => {
        if (s.ptyId) void window.electron.terminal.kill(s.ptyId);
        s.unsubData?.();
        s.unsubExit?.();
        s.terminal.dispose();
      });
    };
  }, []);

  const activeSession = activeTabId ? sessionsRef.current.get(activeTabId) : null;
  const activeStatus = !activeSession
    ? t('terminal.emptyStatus')
    : activeSession.hasExited
      ? t('terminal.exitedStatus')
      : activeSession.isReady
        ? t('terminal.readyStatus')
        : t('terminal.loadingStatus');

  return (
    <div className="terminal-shell" ref={panelRef}>
      <div className="terminal-header">
        <div>
          <span className="terminal-title">{t('nav.terminal')}</span>
          <p className="terminal-subtitle">{t('terminal.subtitle')}</p>
        </div>
        <div className="terminal-actions">
          <span
            className={`terminal-status${activeSession?.isReady ? ' terminal-status-ready' : ''}${activeSession?.hasExited ? ' terminal-status-exited' : ''}`}
            aria-live="polite"
          >
            {activeStatus}
          </span>
          {activeSession && (
            <button
              type="button"
              className="terminal-action"
              title={t('terminal.clear')}
              onClick={() => activeSession.terminal.clear()}
            >
              {t('terminal.clear')}
            </button>
          )}
          {activeSession && activeSession.hasExited && (
            <button
              type="button"
              className="terminal-action"
              onClick={() => {
                if (activeTabId) void restartSession(activeTabId);
              }}
            >
              {t('chat.newSession')}
            </button>
          )}
        </div>
      </div>

      {/* Tab strip */}
      <div className="terminal-tabs" role="tablist" aria-label={t('nav.terminal')}>
        {tabs.map((tab, idx) => (
          <div
            key={tab.tabId}
            className="terminal-tab-shell"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.tabId === activeTabId}
              aria-controls={`terminal-panel-${tab.tabId}`}
              id={`terminal-tab-${tab.tabId}`}
              tabIndex={tab.tabId === activeTabId ? 0 : -1}
              className={`terminal-tab${tab.tabId === activeTabId ? ' terminal-tab-active' : ''}`}
              title={`${tab.label} (${shortcutModifier}${idx + 1})`}
              ref={(el) => {
                if (el) tabButtonRefs.current.set(tab.tabId, el);
                else tabButtonRefs.current.delete(tab.tabId);
              }}
              onClick={() => selectTab(tab.tabId)}
              onKeyDown={(e) => handleTabKeyDown(e, tab.tabId)}
            >
              <span>{tab.label}</span>
              <span
                className={`terminal-tab-state${tab.isReady ? ' is-ready' : ''}${tab.hasExited ? ' is-exited' : ''}`}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              className="terminal-tab-close"
              aria-label={t('terminal.closeTab')}
              title={t('terminal.closeTab')}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.tabId);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="terminal-tab terminal-tab-new"
          aria-label={t('terminal.newTab')}
          title={`${t('terminal.newTab')} (${shortcutModifier}T)`}
          onClick={() => void createTab()}
        >
          +
        </button>
      </div>

      <div className="terminal-surface">
        {tabs.length === 0 ? (
          <div className="terminal-empty-state">
            <p>{t('terminal.noSession')}</p>
            <button type="button" className="terminal-action" onClick={() => void createTab()}>
              {t('terminal.newTab')}
            </button>
          </div>
        ) : (
          tabs.map((tab) => (
            <div
              key={tab.tabId}
              className="terminal-content"
              role="tabpanel"
              id={`terminal-panel-${tab.tabId}`}
              aria-labelledby={`terminal-tab-${tab.tabId}`}
              style={{ display: tab.tabId === activeTabId ? undefined : 'none' }}
            >
              <div
                ref={(el) => handleContainerMount(tab.tabId, el)}
                className="terminal-xterm-host"
              />
              {!tab.isReady && !tab.hasExited && (
                <div className="terminal-state-note" aria-live="polite">
                  {t('terminal.loadingPrompt')}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
