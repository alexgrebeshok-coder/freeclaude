import React, { useState } from 'react';
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
  onAddProject: (name: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onDeleteProject: (projectId: string) => void;
  onReorderProjects: (projectIds: string[]) => void;
  onDeleteChat: (chatId: string) => void;
}

const PRIMARY_ACTIONS: { type: WorkspaceType; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { type: 'search', label: 'Поиск', icon: 'search' }
];

const WORKSPACE_ACTIONS: { type: WorkspaceType; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { type: 'plugins', label: 'Провайдеры', icon: 'plug' },
  { type: 'automations', label: 'Сценарии', icon: 'bolt' },
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
  onSelectProject,
  onAddProject,
  onRenameProject,
  onDeleteProject,
  onReorderProjects,
  onDeleteChat
}: NavigationRailProps): React.ReactElement {
  const [showAllChats, setShowAllChats] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] = useState('');
  const visibleChats = showAllChats ? chats : chats.slice(0, 6);

  const moveProject = (projectId: string, direction: -1 | 1) => {
    const index = projects.findIndex((project) => project.id === projectId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= projects.length) {
      return;
    }
    const ids = projects.map((project) => project.id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    onReorderProjects(ids);
  };

  return (
    <aside className="app-rail">
      <div className="rail-section rail-section-primary">
        <button type="button" className="rail-link rail-link-action" onClick={onNewChat}>
          <Icon name="plus" size={16} />
          <span>Новый чат</span>
        </button>
        <button
          type="button"
          title="Главная"
          className={`rail-link rail-link-home ${activeWorkspace.type === 'home' ? 'active' : ''}`}
          onClick={() => onSelectWorkspace({ type: 'home' })}
        >
          <Icon name="home" size={17} />
          <span>Главная</span>
        </button>
        {PRIMARY_ACTIONS.map((action) => (
          <button
            type="button"
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
            type="button"
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
          <button
            type="button"
            className="rail-section-icon"
            aria-label="Добавить проект"
            title="Добавить проект"
            onClick={() => {
              setAddingProject((value) => !value);
              setEditingProjectId(null);
              setProjectDraft('');
            }}
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
        {addingProject && (
          <form
            className="rail-project-form"
            onSubmit={(event) => {
              event.preventDefault();
              onAddProject(projectDraft);
              setProjectDraft('');
              setAddingProject(false);
            }}
          >
            <input
              value={projectDraft}
              onChange={(event) => setProjectDraft(event.target.value)}
              placeholder="Название проекта"
              aria-label="Название нового проекта"
              autoFocus
            />
            <button type="submit" disabled={!projectDraft.trim()}>
              Создать
            </button>
          </form>
        )}
        <div className="rail-list">
          {projects.map((project, index) => (
            <div key={project.id} className="rail-row-shell rail-project-shell">
              {editingProjectId === project.id ? (
                <form
                  className="rail-project-form rail-project-form-inline"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onRenameProject(project.id, projectDraft);
                    setEditingProjectId(null);
                    setProjectDraft('');
                  }}
                >
                  <input
                    value={projectDraft}
                    onChange={(event) => setProjectDraft(event.target.value)}
                    aria-label={`Переименовать проект ${project.name}`}
                    autoFocus
                  />
                  <button type="submit" disabled={!projectDraft.trim()}>
                    OK
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className={`rail-row ${selectedProjectId === project.id ? 'active' : ''}`}
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
                  <div className="rail-project-actions">
                    <button
                      type="button"
                      aria-label={`Поднять проект ${project.name}`}
                      title="Выше"
                      disabled={index === 0}
                      onClick={() => moveProject(project.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Опустить проект ${project.name}`}
                      title="Ниже"
                      disabled={index === projects.length - 1}
                      onClick={() => moveProject(project.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Переименовать проект ${project.name}`}
                      title="Переименовать"
                      onClick={() => {
                        setEditingProjectId(project.id);
                        setAddingProject(false);
                        setProjectDraft(project.name);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      aria-label={`Удалить проект ${project.name}`}
                      title="Удалить"
                      disabled={projects.length <= 1}
                      onClick={() => {
                        if (window.confirm(`Удалить проект «${project.name}»? Чаты будут перенесены в первый доступный проект.`)) {
                          onDeleteProject(project.id);
                        }
                      }}
                    >
                      ×
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rail-section rail-section-grow">
        <div className="rail-section-header">
          <span>Чаты проекта</span>
          <span className="rail-section-badge">{chats.length}</span>
        </div>
        <div className="rail-list">
          {visibleChats.length === 0 ? (
            <div className="rail-empty">Нет чатов в этом проекте</div>
          ) : (
            visibleChats.map((chat) => (
              <div
                key={chat.id}
                className={`rail-row-shell ${activeWorkspace.type === 'chat' && activeWorkspace.id === chat.id ? 'active' : ''}`}
              >
                <button
                  className={`rail-row rail-row-chat-main ${activeWorkspace.type === 'chat' && activeWorkspace.id === chat.id ? 'active' : ''}`}
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
                <button
                  type="button"
                  className="rail-row-delete"
                  title="Удалить чат"
                  aria-label={`Удалить чат ${chat.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (window.confirm(`Удалить чат «${chat.title}»?`)) {
                      onDeleteChat(chat.id);
                    }
                  }}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))
          )}
          {chats.length > 6 && (
            <button type="button" className="rail-show-all" onClick={() => setShowAllChats((value) => !value)}>
              {showAllChats ? 'Свернуть список' : `Показать все (${chats.length})`}
            </button>
          )}
        </div>
      </div>

      <div className="rail-bottom">
        <button
          type="button"
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
