import React from 'react';
import { AppConfig, WorkspaceSelection } from '../../types';
import { Icon } from '../ui/Icon';

interface TopUtilityBarProps {
  activeWorkspace: WorkspaceSelection;
  activeTitle: string;
  projectLabel: string;
  config: AppConfig;
  status: 'ready' | 'working' | 'error';
  lastError: string | null;
  onSelectWorkspace: (workspace: WorkspaceSelection) => void;
}

export function TopUtilityBar({
  activeWorkspace,
  activeTitle,
  projectLabel,
  config,
  status,
  lastError,
  onSelectWorkspace
}: TopUtilityBarProps): React.ReactElement {
  return (
    <header className="topbar">
      <div className="topbar-breadcrumbs">
        <span className="topbar-caption">Workspace</span>
        <div className="topbar-title-group">
          <h1 className="topbar-title">{activeTitle}</h1>
          <span className="topbar-subtitle">{projectLabel}</span>
        </div>
      </div>

      <div className="topbar-actions">
        <button className="topbar-pill" onClick={() => onSelectWorkspace({ type: 'search' })}>
          <Icon name="search" size={15} />
          <span>Поиск</span>
        </button>

        <button className="topbar-pill" onClick={() => onSelectWorkspace({ type: 'terminal' })}>
          <Icon name="terminal" size={15} />
          <span>Локально</span>
        </button>

        <div className="topbar-pill topbar-pill-static">
          <Icon name="sparkles" size={15} />
          <span>{config.provider.toUpperCase()}</span>
        </div>

        <div className="topbar-pill topbar-pill-static">
          <Icon name="sliders" size={15} />
          <span>{config.model}</span>
        </div>

        <div className={`topbar-pill topbar-status topbar-status-${status}`}>
          <span className="topbar-status-dot" />
          <span>{status === 'working' ? 'В работе' : status === 'error' ? 'Нужно внимание' : 'Готово'}</span>
        </div>

        <button className="topbar-pill" onClick={() => onSelectWorkspace({ type: 'settings' })}>
          <Icon name="settings" size={15} />
          <span>Настроить</span>
        </button>
      </div>

      {lastError && activeWorkspace.type !== 'chat' && (
        <div className="topbar-inline-alert">
          <span>{lastError}</span>
        </div>
      )}
    </header>
  );
}
