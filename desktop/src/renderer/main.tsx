import './dev-browser-shim';
import './i18n';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

class DebugErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { err?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {};
  }

  static getDerivedStateFromError(err: Error): { err: Error } {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo): void {
    // #region agent log
    fetch('http://127.0.0.1:7483/ingest/cd715575-ed80-4222-acf6-07a333a1474f', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '87012e' },
      body: JSON.stringify({
        sessionId: '87012e',
        runId: 'pre-fix',
        hypothesisId: 'H6',
        location: 'main.tsx:ErrorBoundary',
        message: err.message,
        data: { stack: err.stack ?? '', componentStack: info.componentStack },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
  }

  render(): React.ReactNode {
    const err = this.state?.err;
    if (err) {
      return (
        <div style={{ padding: 24 }}>
          <h1>FreeClaude UI error</h1>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{err.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// #region agent log
fetch('http://127.0.0.1:7483/ingest/cd715575-ed80-4222-acf6-07a333a1474f', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '87012e' },
  body: JSON.stringify({
    sessionId: '87012e',
    runId: 'pre-fix',
    hypothesisId: 'H5',
    location: 'main.tsx:module',
    message: 'main module evaluated',
    data: {
      hasElectron: typeof window !== 'undefined' && !!window.electron,
      platform: typeof window !== 'undefined' ? window.electron?.platform : undefined
    },
    timestamp: Date.now()
  })
}).catch(() => {});
window.addEventListener('error', (e) => {
  fetch('http://127.0.0.1:7483/ingest/cd715575-ed80-4222-acf6-07a333a1474f', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '87012e' },
    body: JSON.stringify({
      sessionId: '87012e',
      runId: 'pre-fix',
      hypothesisId: 'H2',
      location: 'main.tsx:window.error',
      message: String(e.message),
      data: {
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        error: e.error instanceof Error ? e.error.message : String(e.error)
      },
      timestamp: Date.now()
    })
  }).catch(() => {});
});
window.addEventListener('unhandledrejection', (e) => {
  fetch('http://127.0.0.1:7483/ingest/cd715575-ed80-4222-acf6-07a333a1474f', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '87012e' },
    body: JSON.stringify({
      sessionId: '87012e',
      runId: 'pre-fix',
      hypothesisId: 'H2',
      location: 'main.tsx:unhandledrejection',
      message: 'unhandledrejection',
      data: { reason: e.reason instanceof Error ? e.reason.message : String(e.reason) },
      timestamp: Date.now()
    })
  }).catch(() => {});
});
// #endregion

// Notify the main process that the renderer mounted. The main process gates
// the FreeClaude bridge start on this handshake (see Track B's bootstrap).
// Wrapped in a microtask so React's first paint is not blocked by IPC.
queueMicrotask(() => {
  void window.electron?.app?.rendererReady?.();
});

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <DebugErrorBoundary>
      <React.StrictMode>
        <App />
      </React.StrictMode>
    </DebugErrorBoundary>
  );
}
