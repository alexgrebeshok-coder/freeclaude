import './dev-browser-shim';
import './i18n';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

class RootErrorBoundary extends React.Component<
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
    <RootErrorBoundary>
      <React.StrictMode>
        <App />
      </React.StrictMode>
    </RootErrorBoundary>
  );
}
