import React from 'react';
import { useAppVersion } from '../hooks/useAppVersion';

type View = 'chat' | 'terminal' | 'files' | 'settings';

interface SidebarProps {
  activeView: View;
  onViewChange: (view: View) => void;
}

export function Sidebar({ activeView, onViewChange }: SidebarProps): React.ReactElement {
  const version = useAppVersion();
  const items: { id: View; label: string; icon: string }[] = [
    { id: 'chat', label: 'Chat', icon: '💬' },
    { id: 'terminal', label: 'Terminal', icon: '💻' },
    { id: 'files', label: 'Files', icon: '📁' },
    { id: 'settings', label: 'Settings', icon: '⚙️' }
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="url(#logo-gradient)" />
            <text x="16" y="22" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">F</text>
          </svg>
          <span className="logo-text">FreeClaude</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {items.map(item => (
          <button
            key={item.id}
            className={`nav-item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => onViewChange(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span className="version">v{version}</span>
      </div>
    </aside>
  );
}
