import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export function Terminal(): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;

    // Create terminal
    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0f0f0f',
        foreground: '#e4e4e4',
        cursor: '#e4e4e4',
        selectionBackground: '#6366f1',
        black: '#000000',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#6366f1',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#bfbfbf',
        brightBlack: '#4d4d4d',
        brightRed: '#ff6e67',
        brightGreen: '#5af78e',
        brightYellow: '#f4f99d',
        brightBlue: '#caa9fa',
        brightMagenta: '#ff92d0',
        brightCyan: '#9aedfe',
        brightWhite: '#e6e6e6'
      }
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Create terminal in main process
    const cols = terminal.cols;
    const rows = terminal.rows;

    window.electron.terminal.create({ cols, rows }).then(id => {
      setTerminalId(id as string);
      setIsReady(true);
    });

    // Handle input
    terminal.onData(data => {
      if (terminalId) {
        window.electron.terminal.write(terminalId, data);
      }
    });

    // Handle resize
    terminal.onResize(({ cols, rows }) => {
      if (terminalId) {
        window.electron.terminal.resize(terminalId, cols, rows);
      }
    });

    // Listen for data from main process
    const unsubscribe = window.electron.terminal.onData((id: string, data: string) => {
      if (id === terminalId) {
        terminal.write(data);
      }
    });

    // Handle window resize
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      unsubscribe();
      window.removeEventListener('resize', handleResize);
      terminal.dispose();
      if (terminalId) {
        window.electron.terminal.kill(terminalId);
      }
    };
  }, [terminalId]);

  return (
    <div className="terminal-container">
      <div className="terminal-header">
        <span className="terminal-title">Terminal</span>
        <div className="terminal-actions">
          <button className="terminal-action" title="Clear" onClick={() => terminalRef.current?.clear()}>
            Clear
          </button>
          {!isReady && <span className="terminal-status">Connecting...</span>}
        </div>
      </div>
      <div ref={containerRef} className="terminal-content" />
    </div>
  );
}
