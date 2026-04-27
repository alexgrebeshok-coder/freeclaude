import React from 'react';
import { ChatSession, ProjectSummary, WorkspaceSelection, WorkspaceType } from '../../types';
import { Icon } from '../ui/Icon';

interface NavigationRailProps {
  version: string;
  chats: ChatSession[];
  projects: ProjectSummary[];
  activeWorkspace: WorkspaceSelection;
  selectedProjectId: string;
  onNewChat: () => void;
  onSelectWorkspace: (workspace: WorkspaceSelection) => void;
  onSelectProject: (projectId: string) => void;
}

const PRIMARY_ACTIONS: { type: WorkspaceType; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { type: 'search', label: 'Поиск', icon: 'search' },
  { type: 'plugins', label: 'Плагины', icon: 'plug' },
  { type: 'automations', label: 'Автоматизации', icon: 'bolt' }
];

const WORKSPACE_ACTIONS: { type: WorkspaceType; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { type: 'terminal', label: 'Терминал', icon: 'terminal' },
  { type: 'files', label: 'Файлы', icon: 'folder' }
];

export function NavigationRail({
  version,
  chats,
  projects,
  activeWorkspace,
  selectedProjectId,
  onNewChat,
  onSelectWorkspace,
  onSelectProject
}: NavigationRailProps): React.ReactElement {
  const recentChats = chats.slice(0, 6);

  return (
    <aside className="app-rail">
      <div className="rail-top">
        <div className="rail-brand">
          <div className="brand-mark">F</div>
          <div className="brand-copy">
            <span className="brand-title">FreeClaude</span>
            <span className="brand-subtitle">Desktop Intelligence</span>
          </div>
        </div>

        <button className="rail-primary-button" onClick={onNewChat}>
          <Icon name="plus" size={16} />
          <span>Новый чат</span>
        </button>
      </div>

      <div className="rail-section rail-section-primary">
        {PRIMARY_ACTIONS.map((action) => (
          <button
            key={action.type}
            className={`rail-link ${activeWorkspace.type === action.type ? 'active' : ''}`}
            onClick={() => onSelectWorkspace({ type: action.type })}
          >
            <Icon name={action.icon} size={17} />
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      <div className="rail-section">
        <div className="rail-section-header">
          <span>Рабочие пространства</span>
        </div>
        {WORKSPACE_ACTIONS.map((action) => (
          <button
            key={action.type}
            className={`rail-link ${activeWorkspace.type === action.type ? 'active' : ''}`}
            onClick={() => onSelectWorkspace({ type: action.type })}
          >
            <Icon name={action.icon} size={17} />
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      <div className="rail-section">
        <div className="rail-section-header">
          <span>Проекты</span>
        </div>
        <div className="rail-list">
          {projects.map((project) => (
            <button
              key={project.id}
              className={`rail-row ${selectedProjectId === project.id && activeWorkspace.type === 'home' ? 'active' : ''}`}
              onClick={() => onSelectProject(project.id)}
            >
              <div className="rail-row-icon">
                <Icon name="folder" size={16} />
              </div>
              <div className="rail-row-copy">
                <span className="rail-row-title">{project.name}</span>
                <span className="rail-row-meta">{project.subtitle}</span>
              </div>
              <span className="rail-row-time">{formatRelativeTime(project.lastOpenedAt)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rail-section rail-section-grow">
        <div className="rail-section-header">
          <span>Чаты</span>
          <span className="rail-section-badge">{chats.length}</span>
        </div>
        <div className="rail-list">
          {recentChats.length === 0 ? (
            <div className="rail-empty">Нет чатов</div>
          ) : (
            recentChats.map((chat) => (
              <button
                key={chat.id}
                className={`rail-row ${activeWorkspace.type === 'chat' && activeWorkspace.id === chat.id ? 'active' : ''}`}
                onClick={() => onSelectWorkspace({ type: 'chat', id: chat.id })}
              >
                <div className="rail-row-icon">
                  <Icon name="chat" size={16} />
                </div>
                <div className="rail-row-copy">
                  <span className="rail-row-title">{chat.title}</span>
                  <span className="rail-row-meta">
                    {chat.isGenerating ? 'Идёт ответ…' : `${chat.messages.length} сообщений`}
                  </span>
                </div>
                <span className="rail-row-time">{formatRelativeTime(chat.updatedAt)}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="rail-bottom">
        <button
          className={`rail-link rail-link-settings ${activeWorkspace.type === 'settings' ? 'active' : ''}`}
          onClick={() => onSelectWorkspace({ type: 'settings' })}
        >
          <Icon name="settings" size={17} />
          <span>Настройки</span>
        </button>
        <div className="rail-version">v{version}</div>
      </div>
    </aside>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor(diff / (1000 * 60));

  if (hours > 24) {
    return `${Math.floor(hours / 24)}д`;
  }
  if (hours > 0) {
    return `${hours}ч`;
  }
  if (minutes > 0) {
    return `${minutes}м`;
  }
  return 'Сейчас';
}
