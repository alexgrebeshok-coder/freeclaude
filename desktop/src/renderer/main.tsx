import './dev-browser-shim';
import './i18n';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

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
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
