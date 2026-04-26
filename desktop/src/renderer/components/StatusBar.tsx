import React, { useState, useEffect } from 'react';

interface StatusBarProps {
  isGenerating: boolean;
}

export function StatusBar({ isGenerating }: StatusBarProps): React.ReactElement {
  const [provider, setProvider] = useState('GLM-5.1');
  const [connected, setConnected] = useState(true);
  const [cwd, setCwd] = useState('~');

  useEffect(() => {
    const loadConfig = async () => {
      const savedProvider = await window.electron.config.get('provider') as string;
      const savedModel = await window.electron.config.get('model') as string;
      if (savedModel) {
        setProvider(savedModel.toUpperCase());
      } else if (savedProvider) {
        setProvider(savedProvider.toUpperCase());
      }
    };

    loadConfig();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.freeclaude.onError(() => {
      setConnected(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <footer className="status-bar">
      <div className="status-left">
        {isGenerating ? (
          <div className="status-item generating">
            <span className="spinner"></span>
            <span>Generating...</span>
          </div>
        ) : (
          <div className="status-item">
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
            <span>{connected ? 'Ready' : 'Disconnected'}</span>
          </div>
        )}
      </div>

      <div className="status-center">
        <div className="status-item">
          <span className="status-label">Model:</span>
          <span className="status-value">{provider}</span>
        </div>
      </div>

      <div className="status-right">
        <div className="status-item">
          <span className="status-label">FreeClaude Desktop</span>
        </div>
      </div>
    </footer>
  );
}
