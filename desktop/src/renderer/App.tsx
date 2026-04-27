import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chat } from './components/Chat';
import { FileExplorer } from './components/FileExplorer';
import { HomeCanvas, HomeSuggestion } from './components/home/HomeCanvas';
import { Settings } from './components/Settings';
import { NavigationRail } from './components/shell/NavigationRail';
import { TopUtilityBar } from './components/shell/TopUtilityBar';
import { Terminal } from './components/Terminal';
import { Icon } from './components/ui/Icon';
import { useAppVersion } from './hooks/useAppVersion';
import {
  AppConfig,
  ChatSession,
  FilePreview,
  Message,
  ProjectSummary,
  WorkspaceSelection,
  WorkspaceType
} from './types';

const STORAGE_KEY = 'freeclaude-shell-state-v1';

const DEFAULT_CONFIG: AppConfig = {
  provider: 'glm',
  apiKey: '',
  model: 'glm-5.1',
  theme: 'light',
  fontSize: 14
};

const DEFAULT_PROJECTS: ProjectSummary[] = [
  {
    id: 'workspace-local',
    name: 'Проекты VSCode',
    subtitle: 'Локальное пространство',
    contextLabel: 'Работать локально',
    lastOpenedAt: Date.now()
  },
  {
    id: 'workspace-agents',
    name: 'FreeClaude Ops',
    subtitle: 'Плагины, агенты, настройки',
    contextLabel: 'AI workspace',
    lastOpenedAt: Date.now() - 1000 * 60 * 43
  }
];

export default function App(): React.ReactElement {
  const version = useAppVersion();
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSelection>({ type: 'home' });
  const [selectedProjectId, setSelectedProjectId] = useState(DEFAULT_PROJECTS[0].id);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [homeDraft, setHomeDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<'ready' | 'working' | 'error'>('ready');
  const [lastError, setLastError] = useState<string | null>(null);
  const runningChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    const loadShellState = () => {
      try {
        const rawState = localStorage.getItem(STORAGE_KEY);
        if (!rawState) {
          return;
        }

        const parsed = JSON.parse(rawState) as {
          chats?: ChatSession[];
          activeWorkspace?: WorkspaceSelection;
          selectedProjectId?: string;
          homeDraft?: string;
        };

        if (Array.isArray(parsed.chats)) {
          setChats(parsed.chats.map((chat) => rehydrateChatSession(chat)));
        }
        if (parsed.activeWorkspace?.type) {
          setActiveWorkspace(parsed.activeWorkspace);
        }
        if (parsed.selectedProjectId) {
          setSelectedProjectId(parsed.selectedProjectId);
        }
        if (typeof parsed.homeDraft === 'string') {
          setHomeDraft(parsed.homeDraft);
        }
      } catch (error) {
        console.error('Failed to restore UI shell state:', error);
      }
    };

    const loadConfig = async () => {
      try {
        const provider = await window.electron.config.get('provider') as AppConfig['provider'];
        const apiKey = await window.electron.config.get('apiKey') as string;
        const model = await window.electron.config.get('model') as string;
        const theme = await window.electron.config.get('theme') as AppConfig['theme'];
        const fontSize = await window.electron.config.get('fontSize') as number;

        setAppConfig({
          provider: provider || DEFAULT_CONFIG.provider,
          apiKey: apiKey || DEFAULT_CONFIG.apiKey,
          model: model || DEFAULT_CONFIG.model,
          theme: theme || DEFAULT_CONFIG.theme,
          fontSize: fontSize || DEFAULT_CONFIG.fontSize
        });
      } catch (error) {
        console.error('Failed to load desktop config:', error);
      }
    };

    loadShellState();
    void loadConfig();
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        chats,
        activeWorkspace,
        selectedProjectId,
        homeDraft
      })
    );
  }, [activeWorkspace, chats, homeDraft, selectedProjectId]);

  useEffect(() => {
    const root = document.documentElement;
    const resolvedTheme = appConfig.theme === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : appConfig.theme;

    root.dataset.theme = resolvedTheme;
    root.style.fontSize = `${appConfig.fontSize}px`;
  }, [appConfig.fontSize, appConfig.theme]);

  useEffect(() => {
    const unsubscribeMessage = window.electron.freeclaude.onMessage((data: unknown) => {
      const chatId = runningChatIdRef.current;
      if (!chatId) {
        return;
      }

      const message = data as { type?: string; content?: string; done?: boolean; sessionId?: string };

      if (message.type === 'session' && message.sessionId) {
        setChats((prev) => prev.map((chat) => (
          chat.id === chatId
            ? { ...chat, sessionId: message.sessionId }
            : chat
        )));
        return;
      }

      if (message.type === 'content') {
        setChats((prev) => prev.map((chat) => (
          chat.id === chatId
            ? {
                ...chat,
                streamingMessage: chat.streamingMessage + (message.content || ''),
                updatedAt: Date.now()
              }
            : chat
        )));
        return;
      }

      if (message.done) {
        setChats((prev) => prev.map((chat) => {
          if (chat.id !== chatId) {
            return chat;
          }

          const assistantText = chat.streamingMessage.trim();
          const assistantMessage = assistantText
            ? [{
                id: createId('assistant'),
                role: 'assistant' as const,
                content: assistantText,
                timestamp: Date.now()
              }]
            : [];

          return {
            ...chat,
            messages: [...chat.messages, ...assistantMessage],
            streamingMessage: '',
            isGenerating: false,
            lastError: undefined,
            updatedAt: Date.now()
          };
        }));

        runningChatIdRef.current = null;
        setStatus('ready');
        setLastError(null);
      }
    });

    const unsubscribeError = window.electron.freeclaude.onError((error: unknown) => {
      const errorMessage = normalizeError(error);
      const chatId = runningChatIdRef.current;

      if (chatId) {
        setChats((prev) => prev.map((chat) => {
          if (chat.id !== chatId) {
            return chat;
          }

          const partialText = chat.streamingMessage.trim();
          const nextMessages = [...chat.messages];

          if (partialText) {
            nextMessages.push({
              id: createId('assistant'),
              role: 'assistant',
              content: partialText,
              timestamp: Date.now()
            });
          }

          nextMessages.push({
            id: createId('tool'),
            role: 'tool',
            content: errorMessage,
            timestamp: Date.now()
          });

          return {
            ...chat,
            messages: nextMessages,
            streamingMessage: '',
            isGenerating: false,
            lastError: errorMessage,
            updatedAt: Date.now()
          };
        }));
      }

      runningChatIdRef.current = null;
      setStatus('error');
      setLastError(errorMessage);
    });

    return () => {
      unsubscribeMessage();
      unsubscribeError();
    };
  }, []);

  const orderedChats = useMemo(
    () => [...chats].sort((a, b) => b.updatedAt - a.updatedAt),
    [chats]
  );

  const activeChat = useMemo(
    () => orderedChats.find((chat) => activeWorkspace.type === 'chat' && chat.id === activeWorkspace.id) || null,
    [activeWorkspace.id, activeWorkspace.type, orderedChats]
  );

  const projects = useMemo(() => (
    DEFAULT_PROJECTS.map((project) => {
      const projectChats = chats.filter((chat) => chat.projectId === project.id);
      return {
        ...project,
        lastOpenedAt: projectChats[0]?.updatedAt || project.lastOpenedAt
      };
    })
  ), [chats]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || projects[0];

  const homeSuggestions = useMemo<HomeSuggestion[]>(() => {
    if (selectedProjectId === 'workspace-agents') {
      return [
        {
          id: 'agents-1',
          title: 'Подготовь подробный roadmap',
          description: 'Собери plan для следующего спринта, рисков и UX-приоритетов.',
          prompt: 'Собери для этого продукта roadmap на следующий спринт, с рисками, функциональными приоритетами и проверками качества.'
        },
        {
          id: 'agents-2',
          title: 'Спроектируй automation flow',
          description: 'Опиши, как связать UI, терминал, файлы и чат в единый сценарий.',
          prompt: 'Спроектируй automation flow для desktop-приложения: как связать чат, терминал, файловый обзор и настройки в единую рабочую цепочку.'
        },
        {
          id: 'agents-3',
          title: 'Проведи продуктовый аудит',
          description: 'Найди слабые места в UX, статусах и информационной архитектуре.',
          prompt: 'Проведи продуктовый аудит интерфейса FreeClaude и предложи улучшения по UX, навигации и функциональной полноте.'
        }
      ];
    }

    return [
      {
        id: 'workspace-1',
        title: 'Проведи анализ приложения',
        description: 'Разложи архитектуру, потоки состояний и критические UX-риски.',
        prompt: 'Проведи анализ приложения, выдели ключевые архитектурные блоки, UX-риски и зоны улучшения.'
      },
      {
        id: 'workspace-2',
        title: 'Подготовь implementation plan',
        description: 'Собери последовательный план работ по фиче или редизайну.',
        prompt: 'Подготовь детальный implementation plan по этой задаче, с этапами, рисками и критериями приёмки.'
      },
      {
        id: 'workspace-3',
        title: 'Почини конкретную проблему',
        description: 'Опиши баг, и FreeClaude соберёт план устранения и проверки.',
        prompt: 'Разберись с проблемой в этом приложении, найди root cause и предложи безопасное исправление.'
      }
    ];
  }, [selectedProjectId]);

  const searchResults = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return {
        chatMatches: orderedChats.slice(0, 5),
        projectMatches: projects
      };
    }

    return {
      chatMatches: orderedChats.filter((chat) => (
        chat.title.toLowerCase().includes(normalizedQuery) ||
        chat.messages.some((message) => message.content.toLowerCase().includes(normalizedQuery))
      )),
      projectMatches: projects.filter((project) => (
        project.name.toLowerCase().includes(normalizedQuery) ||
        project.subtitle.toLowerCase().includes(normalizedQuery)
      ))
    };
  }, [orderedChats, projects, searchQuery]);

  const saveConfig = useCallback(async (nextConfig: AppConfig) => {
    await window.electron.config.set('provider', nextConfig.provider);
    await window.electron.config.set('apiKey', nextConfig.apiKey);
    await window.electron.config.set('model', nextConfig.model);
    await window.electron.config.set('theme', nextConfig.theme);
    await window.electron.config.set('fontSize', nextConfig.fontSize);
    setAppConfig(nextConfig);
    setStatus('ready');
    setLastError(null);
  }, []);

  const handleSelectWorkspace = useCallback((workspace: WorkspaceSelection) => {
    setActiveWorkspace(workspace);
  }, []);

  const handleSelectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setActiveWorkspace({ type: 'home' });
  }, []);

  const handleNewChat = useCallback(() => {
    const chat = createChatSession(selectedProjectId);
    setChats((prev) => [chat, ...prev]);
    setActiveWorkspace({ type: 'chat', id: chat.id });
    setStatus('ready');
    setLastError(null);
  }, [selectedProjectId]);

  const updateChatDraft = useCallback((chatId: string, draft: string) => {
    setChats((prev) => prev.map((chat) => (
      chat.id === chatId
        ? { ...chat, draft }
        : chat
    )));
  }, []);

  const submitPrompt = useCallback((content: string, chatId?: string) => {
    const prompt = content.trim();
    if (!prompt) {
      return;
    }

    const effectiveChatId = chatId || (activeWorkspace.type === 'chat' ? activeWorkspace.id : undefined) || createId('chat');
    const userMessage: Message = {
      id: createId('user'),
      role: 'user',
      content: prompt,
      timestamp: Date.now()
    };

    const existingChat = chats.find((chat) => chat.id === effectiveChatId);

    setChats((prev) => {
      let hasExistingChat = false;

      const nextChats = prev.map((chat) => {
        if (chat.id !== effectiveChatId) {
          return chat;
        }

        hasExistingChat = true;
        const nextMessages = [...chat.messages, userMessage];
        return {
          ...chat,
          title: chat.messages.length === 0 ? toChatTitle(prompt) : chat.title,
          messages: nextMessages,
          draft: '',
          isGenerating: true,
          streamingMessage: '',
          lastError: undefined,
          updatedAt: Date.now()
        };
      });

      if (hasExistingChat) {
        return nextChats;
      }

      const newChat: ChatSession = {
        id: effectiveChatId,
        title: toChatTitle(prompt),
        projectId: selectedProjectId,
        messages: [userMessage],
        draft: '',
        isGenerating: true,
        streamingMessage: '',
        updatedAt: Date.now()
      };

      return [newChat, ...nextChats];
    });

    if (activeWorkspace.type !== 'chat' || activeWorkspace.id !== effectiveChatId) {
      setActiveWorkspace({ type: 'chat', id: effectiveChatId });
    }

    if (activeWorkspace.type === 'home') {
      setHomeDraft('');
    }

    runningChatIdRef.current = effectiveChatId;
    setStatus('working');
    setLastError(null);

    const history = [
      ...(existingChat?.messages || []),
      userMessage
    ].map((message) => ({
      role: message.role,
      content: message.content
    }));

    window.electron.freeclaude.send({
      type: 'message',
      content: prompt,
      history,
      sessionId: existingChat?.sessionId
    });
  }, [activeWorkspace.id, activeWorkspace.type, chats, selectedProjectId]);

  const handleCancel = useCallback(() => {
    const runningChatId = runningChatIdRef.current;
    window.electron.freeclaude.cancel();

    if (runningChatId) {
      setChats((prev) => prev.map((chat) => {
        if (chat.id !== runningChatId) {
          return chat;
        }

        const partial = chat.streamingMessage.trim();
        const nextMessages = partial
          ? [...chat.messages, {
              id: createId('assistant'),
              role: 'assistant' as const,
              content: partial,
              timestamp: Date.now()
            }]
          : chat.messages;

        return {
          ...chat,
          messages: nextMessages,
          streamingMessage: '',
          isGenerating: false,
          updatedAt: Date.now()
        };
      }));
    }

    runningChatIdRef.current = null;
    setStatus('ready');
  }, []);

  const activeTitle = getWorkspaceTitle(activeWorkspace.type, activeChat?.title);

  return (
    <div className="app-shell">
      <NavigationRail
        version={version}
        chats={orderedChats}
        projects={projects}
        activeWorkspace={activeWorkspace}
        selectedProjectId={selectedProjectId}
        onNewChat={handleNewChat}
        onSelectWorkspace={handleSelectWorkspace}
        onSelectProject={handleSelectProject}
      />

      <div className="app-frame">
        <TopUtilityBar
          activeWorkspace={activeWorkspace}
          activeTitle={activeTitle}
          projectLabel={selectedProject.name}
          config={appConfig}
          status={status}
          lastError={lastError}
          onSelectWorkspace={handleSelectWorkspace}
        />

        <div className="workspace-stack">
          <section className={`workspace-panel ${activeWorkspace.type === 'home' ? 'is-active' : ''}`}>
            <HomeCanvas
              heading={`Что сделаем в ${selectedProject.name}?`}
              subheading="Соберите новый запрос, откройте проектный контекст и продолжайте работу в одном desktop workspace — без потери функциональности."
              draft={homeDraft}
              isGenerating={status === 'working' && activeWorkspace.type === 'home'}
              projectLabel={selectedProject.name}
              providerLabel={appConfig.provider.toUpperCase()}
              modelLabel={appConfig.model}
              onDraftChange={setHomeDraft}
              onSend={(value) => submitPrompt(value)}
              onCancel={handleCancel}
              suggestions={homeSuggestions}
            />
          </section>

          <section className={`workspace-panel ${activeWorkspace.type === 'chat' ? 'is-active' : ''}`}>
            {activeChat ? (
              <Chat
                title={activeChat.title}
                messages={activeChat.messages}
                streamingMessage={activeChat.streamingMessage}
                isGenerating={activeChat.isGenerating}
                draft={activeChat.draft}
                lastError={activeChat.lastError || lastError || undefined}
                onDraftChange={(value) => updateChatDraft(activeChat.id, value)}
                onSend={(value) => submitPrompt(value, activeChat.id)}
                onCancel={handleCancel}
              />
            ) : (
              <EmptyWorkspaceCard
                title="Выберите чат"
                description="Откройте существующий диалог слева или создайте новый чат, чтобы продолжить работу."
                actionLabel="Новый чат"
                onAction={handleNewChat}
              />
            )}
          </section>

          <section className={`workspace-panel ${activeWorkspace.type === 'search' ? 'is-active' : ''}`}>
            <div className="workspace-sheet">
              <div className="workspace-sheet-header">
                <span className="conversation-kicker">Global search</span>
                <h2>Найдите чат, проект или рабочий сценарий</h2>
                <p>Поиск проходит по названиям чатов, тексту сообщений и карточкам рабочих пространств.</p>
              </div>
              <div className="search-panel">
                <div className="search-input-card">
                  <Icon name="search" size={18} />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Например: terminal, roadmap, provider, refactor..."
                    className="search-input"
                  />
                </div>

                <div className="insight-grid insight-grid-two">
                  <div className="insight-card">
                    <div className="insight-card-head">
                      <span>Проекты</span>
                    </div>
                    {searchResults.projectMatches.map((project) => (
                      <button
                        key={project.id}
                        className="result-row"
                        onClick={() => handleSelectProject(project.id)}
                      >
                        <div className="result-row-copy">
                          <span className="result-row-title">{project.name}</span>
                          <span className="result-row-meta">{project.subtitle}</span>
                        </div>
                        <Icon name="chevron-right" size={16} />
                      </button>
                    ))}
                  </div>

                  <div className="insight-card">
                    <div className="insight-card-head">
                      <span>Чаты</span>
                    </div>
                    {searchResults.chatMatches.length === 0 ? (
                      <div className="rail-empty">Ничего не найдено</div>
                    ) : (
                      searchResults.chatMatches.map((chat) => (
                        <button
                          key={chat.id}
                          className="result-row"
                          onClick={() => handleSelectWorkspace({ type: 'chat', id: chat.id })}
                        >
                          <div className="result-row-copy">
                            <span className="result-row-title">{chat.title}</span>
                            <span className="result-row-meta">{chat.messages.length} сообщений</span>
                          </div>
                          <Icon name="chevron-right" size={16} />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className={`workspace-panel ${activeWorkspace.type === 'plugins' ? 'is-active' : ''}`}>
            <div className="workspace-sheet">
              <div className="workspace-sheet-header">
                <span className="conversation-kicker">Providers & integrations</span>
                <h2>Подключения и AI-режимы</h2>
                <p>Соберите стек под текущую задачу: провайдеры, модели, локальный режим и рабочий контекст.</p>
              </div>
              <div className="insight-grid insight-grid-three">
                <InsightCard
                  title="Текущий провайдер"
                  meta={appConfig.provider.toUpperCase()}
                  description={`Модель ${appConfig.model} уже подключена к desktop bridge.`}
                  actionLabel="Открыть настройки"
                  onAction={() => handleSelectWorkspace({ type: 'settings' })}
                />
                <InsightCard
                  title="Файлы и контекст"
                  meta="Workspace aware"
                  description="Открывайте нужные файлы и используйте их как быстрый контекст для запросов и анализа."
                  actionLabel="Открыть файлы"
                  onAction={() => handleSelectWorkspace({ type: 'files' })}
                />
                <InsightCard
                  title="Локальный терминал"
                  meta="PTY session"
                  description="Проверки, команды, build-циклы и отладка доступны прямо внутри shell."
                  actionLabel="Открыть терминал"
                  onAction={() => handleSelectWorkspace({ type: 'terminal' })}
                />
              </div>
            </div>
          </section>

          <section className={`workspace-panel ${activeWorkspace.type === 'automations' ? 'is-active' : ''}`}>
            <div className="workspace-sheet">
              <div className="workspace-sheet-header">
                <span className="conversation-kicker">Workflow launcher</span>
                <h2>Автоматизации и быстрые сценарии</h2>
                <p>Запускайте готовые рабочие потоки без потери доступа к чатам, терминалу и файловому контексту.</p>
              </div>
              <div className="insight-grid insight-grid-three">
                <InsightCard
                  title="Собрать implementation plan"
                  meta="Chat workflow"
                  description="Запускает новый чат с промптом для полного плана и критериев приёмки."
                  actionLabel="Старт"
                  onAction={() => submitPrompt('Собери подробный implementation plan для текущей задачи с этапами, рисками и критериями приемки.')}
                />
                <InsightCard
                  title="Открыть диагностику"
                  meta="Terminal workflow"
                  description="Переключает в terminal workspace для запуска локальных команд и smoke-проверок."
                  actionLabel="Открыть"
                  onAction={() => handleSelectWorkspace({ type: 'terminal' })}
                />
                <InsightCard
                  title="Подготовить файловый контекст"
                  meta="File workflow"
                  description="Переходит в файловый обзор, где можно открыть и изучить нужные файлы перед запросом."
                  actionLabel="Открыть файлы"
                  onAction={() => handleSelectWorkspace({ type: 'files' })}
                />
              </div>
            </div>
          </section>

          <section className={`workspace-panel ${activeWorkspace.type === 'terminal' ? 'is-active' : ''}`}>
            <Terminal isVisible={activeWorkspace.type === 'terminal'} />
          </section>

          <section className={`workspace-panel ${activeWorkspace.type === 'files' ? 'is-active' : ''}`}>
            <div className="files-workspace">
              <div className="files-browser-pane">
                <FileExplorer
                  onFileSelect={(path, content) => setFilePreview({ path, content })}
                />
              </div>
              <div className="file-preview-pane">
                {filePreview ? (
                  <>
                    <div className="file-preview-header">
                      <div>
                        <span className="conversation-kicker">File preview</span>
                        <h3>{filePreview.path.split('/').pop()}</h3>
                      </div>
                      <span className="file-preview-path">{filePreview.path}</span>
                    </div>
                    <pre className="file-preview-content">{filePreview.content}</pre>
                  </>
                ) : (
                  <div className="file-preview-empty">
                    <Icon name="file" size={22} />
                    <h3>Выберите файл слева</h3>
                    <p>Файловый обзор теперь интегрирован в shell: откройте любой файл и превью появится здесь без смены рабочего контекста.</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className={`workspace-panel ${activeWorkspace.type === 'settings' ? 'is-active' : ''}`}>
            <Settings config={appConfig} onSave={saveConfig} />
          </section>
        </div>
      </div>
    </div>
  );
}

function InsightCard({
  title,
  meta,
  description,
  actionLabel,
  onAction
}: {
  title: string;
  meta: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}): React.ReactElement {
  return (
    <div className="insight-card">
      <div className="insight-card-head">
        <span>{meta}</span>
      </div>
      <div className="insight-card-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <button className="ghost-action-button ghost-action-button-strong" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}

function EmptyWorkspaceCard({
  title,
  description,
  actionLabel,
  onAction
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}): React.ReactElement {
  return (
    <div className="workspace-sheet workspace-sheet-center">
      <div className="file-preview-empty">
        <Icon name="chat" size={22} />
        <h3>{title}</h3>
        <p>{description}</p>
        <button className="ghost-action-button ghost-action-button-strong" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

function createChatSession(projectId: string): ChatSession {
  return {
    id: createId('chat'),
    title: 'Новый чат',
    projectId,
    messages: [],
    draft: '',
    isGenerating: false,
    streamingMessage: '',
    updatedAt: Date.now()
  };
}

function rehydrateChatSession(chat: ChatSession): ChatSession {
  const partial = chat.streamingMessage.trim();
  const recoveredMessages = partial
    ? [
        ...chat.messages,
        {
          id: createId('assistant'),
          role: 'assistant' as const,
          content: partial,
          timestamp: Date.now()
        }
      ]
    : chat.messages;

  return {
    ...chat,
    messages: recoveredMessages,
    isGenerating: false,
    streamingMessage: '',
    lastError: chat.lastError
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeError(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'error' in error) {
    const nested = (error as { error?: unknown }).error;
    return typeof nested === 'string' ? nested : 'Произошла ошибка в рабочем процессе FreeClaude.';
  }
  return 'Произошла ошибка в рабочем процессе FreeClaude.';
}

function toChatTitle(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  return normalized.length > 42 ? `${normalized.slice(0, 39)}…` : normalized;
}

function getWorkspaceTitle(type: WorkspaceType, chatTitle?: string): string {
  switch (type) {
    case 'home':
      return 'Главный workspace';
    case 'chat':
      return chatTitle || 'Активный чат';
    case 'search':
      return 'Поиск по контексту';
    case 'plugins':
      return 'Плагины и интеграции';
    case 'automations':
      return 'Автоматизации';
    case 'terminal':
      return 'Локальный терминал';
    case 'files':
      return 'Файловый обзор';
    case 'settings':
      return 'Настройки';
  }
}
