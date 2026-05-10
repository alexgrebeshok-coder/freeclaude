import React from 'react';
import { AppConfig, WorkspaceSelection } from '../../types';
import { Icon } from '../ui/Icon';

interface TopUtilityBarProps {
  activeWorkspace: WorkspaceSelection;
  activeTitle: string;
  projectLabel: string;
  config: AppConfig;
  providerLabel?: string;
  status: 'ready' | 'working' | 'error';
  lastError: string | null;
  onSelectWorkspace: (workspace: WorkspaceSelection) => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

export function TopUtilityBar({
  activeWorkspace,
  activeTitle,
  projectLabel,
  config,
  providerLabel,
  status,
  lastError,
  onSelectWorkspace,
  inspectorOpen,
  onToggleInspector
}: TopUtilityBarProps): React.ReactElement {
  const isHome = activeWorkspace.type === 'home';

  return (
    <header className={`topbar ${isHome ? 'topbar-home-minimal' : ''}`}>
      {!isHome && (
        <div className="topbar-breadcrumbs">
          <span className="topbar-caption">Рабочая область</span>
          <div className="topbar-title-group">
            <h1 className="topbar-title">{activeTitle}</h1>
            <span className="topbar-subtitle">{projectLabel}</span>
          </div>
        </div>
      )}

      <div className={`topbar-actions ${isHome ? 'topbar-actions-home' : ''}`}>
        <button
          type="button"
          className={`topbar-pill ${inspectorOpen ? 'topbar-pill-active' : ''}`}
          title="Инспектор (⌘I)"
          onClick={onToggleInspector}
        >
          <Icon name="panel-right" size={15} />
          <span>Инспектор</span>
        </button>

        <button type="button" className="topbar-pill" onClick={() => onSelectWorkspace({ type: 'search' })}>
          <Icon name="search" size={15} />
          <span>Поиск</span>
        </button>

        <div className="topbar-pill topbar-pill-static topbar-pill-model" title="Провайдер и модель">
          <Icon name="sparkles" size={15} />
          <span>
            {(providerLabel || config.provider.toUpperCase())} · {config.model}
          </span>
        </div>

        <div className={`topbar-pill topbar-status topbar-status-${status}`}>
          <span className="topbar-status-dot" />
          <span>{status === 'working' ? 'В работе' : status === 'error' ? 'Нужно внимание' : 'Готово'}</span>
        </div>

        <button type="button" className="topbar-pill" onClick={() => onSelectWorkspace({ type: 'settings' })}>
          <Icon name="settings" size={15} />
          <span>Настроить</span>
        </button>
      </div>

      {lastError && activeWorkspace.type !== 'chat' && (
        <div className="topbar-inline-alert" role="alert">
          <span>{lastError}</span>
        </div>
      )}
    </header>
  );
}
