import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface TerminalProps {
  isVisible: boolean;
}

export function Terminal({ isVisible }: TerminalProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const createSessionRef = useRef<(() => Promise<void>) | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [hasExited, setHasExited] = useState(false);

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;

    // Create terminal
    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1d1a16',
        foreground: '#f3efe8',
        cursor: '#f3efe8',
        selectionBackground: '#c46f4a66',
        black: '#40362f',
        red: '#d86b5e',
        green: '#7aa67d',
        yellow: '#d5aa5b',
        blue: '#6c8fc3',
        magenta: '#b987c9',
        cyan: '#62a9b3',
        white: '#e6ddd1',
        brightBlack: '#6f655c',
        brightRed: '#e38478',
        brightGreen: '#94ba96',
        brightYellow: '#dfb96e',
        brightBlue: '#7fa0d1',
        brightMagenta: '#c79fd2',
        brightCyan: '#7ebac2',
        brightWhite: '#fffdf9'
      }
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const createSession = async () => {
      if (terminalIdRef.current) {
        return;
      }

      terminal.clear();
      terminal.write('\x1bc');
      const id = await window.electron.terminal.create({ cols: terminal.cols, rows: terminal.rows });
      terminalIdRef.current = id as string;
      setHasExited(false);
      setIsReady(true);
    };

    createSessionRef.current = createSession;

    const terminalDataSubscription = terminal.onData((data) => {
      const terminalId = terminalIdRef.current;
      if (terminalId) {
        window.electron.terminal.write(terminalId, data);
      }
    });

    const terminalResizeSubscription = terminal.onResize(({ cols, rows }) => {
      const terminalId = terminalIdRef.current;
      if (terminalId) {
        window.electron.terminal.resize(terminalId, cols, rows);
      }
    });

    const unsubscribeData = window.electron.terminal.onData((id: string, data: string) => {
      if (id === terminalIdRef.current) {
        terminal.write(data);
      }
    });

    const unsubscribeExit = window.electron.terminal.onExit((id: string, code: number) => {
      if (id === terminalIdRef.current) {
        setHasExited(true);
        setIsReady(false);
        terminalIdRef.current = null;
        terminal.writeln(`\r\n[terminal exited with code ${code}]`);
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      const terminalId = terminalIdRef.current;
      if (terminalId) {
        window.electron.terminal.resize(terminalId, terminal.cols, terminal.rows);
      }
    };
    window.addEventListener('resize', handleResize);

    void createSession();

    return () => {
      unsubscribeData();
      unsubscribeExit();
      terminalDataSubscription.dispose();
      terminalResizeSubscription.dispose();
      window.removeEventListener('resize', handleResize);
      const terminalId = terminalIdRef.current;
      if (terminalId) {
        window.electron.terminal.kill(terminalId);
        terminalIdRef.current = null;
      }
      createSessionRef.current = null;
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    if (!isVisible || !fitAddonRef.current || !terminalRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      const terminalId = terminalIdRef.current;
      if (terminalId && terminalRef.current) {
        window.electron.terminal.resize(terminalId, terminalRef.current.cols, terminalRef.current.rows);
      }
    });
  }, [isVisible]);

  return (
    <div className="terminal-shell">
      <div className="terminal-header">
        <div>
          <span className="terminal-title">Терминал</span>
          <p className="terminal-subtitle">Локальный shell для быстрых команд, скриптов и smoke-check flows.</p>
        </div>
        <div className="terminal-actions">
          <button className="terminal-action" title="Clear" onClick={() => terminalRef.current?.clear()}>
            Очистить
          </button>
          {(hasExited || !isReady) && (
            <button className="terminal-action" title="New session" onClick={() => void createSessionRef.current?.()}>
              Новый сеанс
            </button>
          )}
          <span className="terminal-status">
            {hasExited ? 'Завершён' : isReady ? 'Подключён' : 'Подключение…'}
          </span>
        </div>
      </div>
      <div className="terminal-surface">
        <div ref={containerRef} className="terminal-content" />
      </div>
    </div>
  );
}
