import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chat } from './components/Chat';
import { FileExplorer } from './components/FileExplorer';
import { HomeCanvas, HomeSuggestion } from './components/home/HomeCanvas';
import { Onboarding } from './components/Onboarding';
import { Settings } from './components/Settings';
import { NavigationRail } from './components/shell/NavigationRail';
import { InspectorPanel } from './components/shell/InspectorPanel';
import { TopUtilityBar } from './components/shell/TopUtilityBar';
import { Terminal } from './components/Terminal';
import { Icon } from './components/ui/Icon';
import { useAppVersion } from './hooks/useAppVersion';
import { useShellShortcuts } from './hooks/useShellShortcuts';
import { loadShellState, saveShellState } from './migrations';
import {
  AppConfig,
  ChatSession,
  FilePreview,
  Message,
  ProjectSummary,
  WorkspaceSelection,
  WorkspaceType
} from './types';

const DEFAULT_CONFIG: AppConfig = {
  provider: 'glm',
  apiKey: '',
  model: 'glm-5.1',
  theme: 'light',
  fontSize: 14
};

const SEED_PROJECTS: ProjectSummary[] = [
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
    contextLabel: 'Рабочая область AI',
    lastOpenedAt: Date.now() - 1000 * 60 * 43
  }
];

export default function App(): React.ReactElement {
  const version = useAppVersion();
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSelection>({ type: 'home' });
  const [projects, setProjects] = useState<ProjectSummary[]>(SEED_PROJECTS);
  const [selectedProjectId, setSelectedProjectId] = useState(SEED_PROJECTS[0].id);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [homeDraft, setHomeDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<'ready' | 'working' | 'error'>('ready');
  const [lastError, setLastError] = useState<string | null>(null);
  const [chatDiagnostics, setChatDiagnostics] = useState<Record<string, string[]>>({});
  // Per-chat diagnostics (populated from 'diagnostic'/'warning' events — never shown in chat).
  // Kept in a ref for event handlers and mirrored to state so Inspector updates live.
  const chatDiagnosticsRef = useRef<Record<string, string[]>>({});
  const runningChatIdRef = useRef<string | null>(null);
  // Maps requestId → chatId so concurrent/queued requests can be routed correctly.
  const requestToChatRef = useRef<Map<string, string>>(new Map());
  const homeComposerRef = useRef<HTMLTextAreaElement>(null);
  const chatComposerRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorCompact, setInspectorCompact] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.platform = window.electron.platform;
  }, []);

  useEffect(() => {
    const hydrateShellState = () => {
      const saved = loadShellState();

      if (saved.chats.length > 0) {
        setChats(saved.chats.map((chat) => rehydrateChatSession(chat)));
      }
      if (saved.activeWorkspace?.type) {
        setActiveWorkspace(saved.activeWorkspace);
      }
      if (saved.selectedProjectId) {
        setSelectedProjectId(saved.selectedProjectId);
      }
      if (typeof saved.homeDraft === 'string') {
        setHomeDraft(saved.homeDraft);
      }
      if (Array.isArray(saved.projects) && saved.projects.length > 0) {
        setProjects(saved.projects);
      }
    };

    const loadConfig = async () => {
      try {
        const provider = await window.electron.config.get('provider') as AppConfig['provider'];
        const apiKey = await window.electron.config.get('apiKey') as string;
        const model = await window.electron.config.get('model') as string;
        const theme = await window.electron.config.get('theme') as AppConfig['theme'];
        const fontSize = await window.electron.config.get('fontSize') as number;
        const localProviders = await window.electron.freeclaude.getProviders() as {
          activeProvider?: string | null;
          activeModel?: string | null;
          providers?: Array<{ id?: string; models?: string[] }>;
        } | undefined;
        const firstProvider = localProviders?.providers?.[0];

        setAppConfig({
          provider: provider || localProviders?.activeProvider || firstProvider?.id || DEFAULT_CONFIG.provider,
          apiKey: apiKey || DEFAULT_CONFIG.apiKey,
          model: model || localProviders?.activeModel || firstProvider?.models?.[0] || DEFAULT_CONFIG.model,
          theme: theme || DEFAULT_CONFIG.theme,
          fontSize: fontSize || DEFAULT_CONFIG.fontSize
        });
      } catch (error) {
        console.error('Failed to load desktop config:', error);
      }
    };

    hydrateShellState();
    void loadConfig();
  }, []);

  useEffect(() => {
    saveShellState({
      chats,
      activeWorkspace,
      selectedProjectId,
      homeDraft,
      projects
    });
  }, [activeWorkspace, chats, homeDraft, projects, selectedProjectId]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${appConfig.fontSize}px`;

    if (appConfig.theme !== 'auto') {
      root.dataset.theme = appConfig.theme;
      return;
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const applySystemTheme = () => {
      root.dataset.theme = mq.matches ? 'dark' : 'light';
    };

    applySystemTheme();
    mq.addEventListener('change', applySystemTheme);
    return () => {
      mq.removeEventListener('change', applySystemTheme);
    };
  }, [appConfig.fontSize, appConfig.theme]);

  useEffect(() => {
    if (activeWorkspace.type === 'search') {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [activeWorkspace.type]);

  useEffect(() => {
    const unsubscribeMessage = window.electron.freeclaude.onMessage((data: unknown) => {
      const message = data as {
        type?: string;
        content?: string;
        done?: boolean;
        sessionId?: string;
        requestId?: string;
        diagnostic?: string;
        warning?: string;
      };

      // Route to the correct chat via requestId; fall back to the legacy ref
      // for events that pre-date requestId stamping.
      const requestId = message.requestId;
      const chatId = requestId
        ? requestToChatRef.current.get(requestId)
        : runningChatIdRef.current;

      if (!chatId) {
        if (requestId) {
          console.warn('[freeclaude] event for unknown requestId, ignoring', requestId, message.type);
        }
        return;
      }

      // Diagnostic events go to the per-chat diagnostics ref, never to chat.
      if (message.type === 'diagnostic') {
        const diag = message.diagnostic || '';
        const next = {
          ...chatDiagnosticsRef.current,
          [chatId]: [...(chatDiagnosticsRef.current[chatId] ?? []), diag].slice(-50)
        };
        chatDiagnosticsRef.current = next;
        setChatDiagnostics(next);
        return;
      }

      // Warning events are logged + added to diagnostics, never to chat.
      if (message.type === 'warning') {
        console.warn('[freeclaude] warning:', message.warning, { requestId, chatId });
        const next = {
          ...chatDiagnosticsRef.current,
          [chatId]: [...(chatDiagnosticsRef.current[chatId] ?? []), `[warning] ${message.warning ?? ''}`].slice(-50)
        };
        chatDiagnosticsRef.current = next;
        setChatDiagnostics(next);
        return;
      }

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

      if (message.done || message.type === 'done') {
        // Guard against stale done events for already-removed requestIds.
        if (requestId && !requestToChatRef.current.has(requestId)) {
          console.warn('[freeclaude] done for already-removed requestId, ignoring', requestId);
          return;
        }

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

        if (requestId) {
          requestToChatRef.current.delete(requestId);
        }

        if (requestToChatRef.current.size === 0) {
          runningChatIdRef.current = null;
          setStatus('ready');
          setLastError(null);
        }
      }
    });

    const unsubscribeError = window.electron.freeclaude.onError((error: unknown) => {
      const errorMessage = normalizeError(error);
      const errorData = error as { requestId?: string };
      const requestId = errorData?.requestId;
      const chatId = requestId
        ? requestToChatRef.current.get(requestId)
        : runningChatIdRef.current;

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

      if (requestId) {
        requestToChatRef.current.delete(requestId);
      }

      if (requestToChatRef.current.size === 0) {
        runningChatIdRef.current = null;
        setStatus('error');
        setLastError(errorMessage);
      } else {
        setLastError(errorMessage);
      }
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

  const chatsForSelectedProject = useMemo(
    () => orderedChats.filter((chat) => chat.projectId === selectedProjectId),
    [orderedChats, selectedProjectId]
  );

  const activeChat = useMemo(
    () => orderedChats.find((chat) => activeWorkspace.type === 'chat' && chat.id === activeWorkspace.id) || null,
    [activeWorkspace.id, activeWorkspace.type, orderedChats]
  );

  // Derive lastOpenedAt from the most recent chat in each project.
  const projectsWithActivity = useMemo(() => (
    projects.map((project) => {
      const latestChatUpdatedAt = chats
        .filter((chat) => chat.projectId === project.id)
        .reduce<number>((max, chat) => Math.max(max, chat.updatedAt), 0);
      return latestChatUpdatedAt > 0
        ? { ...project, lastOpenedAt: latestChatUpdatedAt }
        : project;
    })
  ), [chats, projects]);

  const selectedProject = projectsWithActivity.find((p) => p.id === selectedProjectId)
    ?? projectsWithActivity[0]
    ?? SEED_PROJECTS[0];

  const handleAddProject = useCallback((name: string) => {
    const cleanName = name.trim();
    if (!cleanName) {
      return;
    }
    const project: ProjectSummary = {
      id: createId('project'),
      name: cleanName,
      subtitle: 'Пользовательский проект',
      contextLabel: 'Работать локально',
      lastOpenedAt: Date.now()
    };
    setProjects((prev) => [project, ...prev]);
    setSelectedProjectId(project.id);
    setActiveWorkspace({ type: 'home' });
  }, []);

  const handleRenameProject = useCallback((projectId: string, name: string) => {
    const cleanName = name.trim();
    if (!cleanName) {
      return;
    }
    setProjects((prev) => prev.map((project) => (
      project.id === projectId
        ? { ...project, name: cleanName, lastOpenedAt: Date.now() }
        : project
    )));
  }, []);

  const handleDeleteProject = useCallback((projectId: string) => {
    setProjects((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      const remaining = prev.filter((project) => project.id !== projectId);
      const fallbackProjectId = remaining[0]?.id ?? '';

      setChats((chatPrev) => chatPrev.map((chat) => (
        chat.projectId === projectId ? { ...chat, projectId: fallbackProjectId } : chat
      )));

      if (selectedProjectId === projectId) {
        setSelectedProjectId(fallbackProjectId);
        setActiveWorkspace({ type: 'home' });
      }

      return remaining;
    });
  }, [selectedProjectId]);

  const handleReorderProjects = useCallback((ids: string[]) => {
    setProjects((prev) => {
      const byId = new Map(prev.map((project) => [project.id, project]));
      const ordered = ids.flatMap((id) => {
        const project = byId.get(id);
        return project ? [project] : [];
      });
      const missing = prev.filter((project) => !ids.includes(project.id));
      return [...ordered, ...missing];
    });
  }, []);

  const homeSuggestions = useMemo<HomeSuggestion[]>(() => {
    if (selectedProjectId === 'workspace-agents') {
      return [
        {
          id: 'agents-1',
          title: 'Подготовь дорожную карту',
          description: 'Собери план следующего спринта, рисков и UX-приоритетов.',
          prompt: 'Собери для этого продукта дорожную карту на следующий спринт, с рисками, функциональными приоритетами и проверками качества.'
        },
        {
          id: 'agents-2',
          title: 'Спроектируй рабочий поток',
          description: 'Опиши, как связать UI, терминал, файлы и чат в единый сценарий.',
          prompt: 'Спроектируй рабочий поток для desktop-приложения: как связать чат, терминал, файловый обзор и настройки в единую рабочую цепочку.'
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
        title: 'Подготовь план реализации',
        description: 'Собери последовательный план работ по фиче или редизайну.',
        prompt: 'Подготовь детальный план реализации по этой задаче, с этапами, рисками и критериями приёмки.'
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
        projectMatches: projectsWithActivity
      };
    }

    return {
      chatMatches: orderedChats.filter((chat) => (
        chat.title.toLowerCase().includes(normalizedQuery) ||
        chat.messages.some((message) => message.content.toLowerCase().includes(normalizedQuery))
      )),
      projectMatches: projectsWithActivity.filter((project) => (
        project.name.toLowerCase().includes(normalizedQuery) ||
        project.subtitle.toLowerCase().includes(normalizedQuery)
      ))
    };
  }, [orderedChats, projectsWithActivity, searchQuery]);

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

  const handleDeleteChat = useCallback((chatId: string) => {
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));
    setChatDiagnostics((prev) => {
      const next = { ...prev };
      delete next[chatId];
      chatDiagnosticsRef.current = next;
      return next;
    });

    // Remove any requestId mappings for the deleted chat so stale events are ignored.
    for (const [reqId, cId] of requestToChatRef.current.entries()) {
      if (cId === chatId) {
        requestToChatRef.current.delete(reqId);
      }
    }

    if (requestToChatRef.current.size === 0 && runningChatIdRef.current === chatId) {
      runningChatIdRef.current = null;
      setStatus('ready');
    }

    if (activeWorkspace.type === 'chat' && activeWorkspace.id === chatId) {
      setActiveWorkspace({ type: 'home' });
      setLastError(null);
    }
  }, [activeWorkspace.id, activeWorkspace.type]);

  const handleRenameChat = useCallback((chatId: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      return;
    }
    setChats((prev) => prev.map((chat) => (
      chat.id === chatId
        ? { ...chat, title: nextTitle, updatedAt: Date.now() }
        : chat
    )));
  }, []);

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

    // Bridge now queues concurrent requests — no longer block the second send.

    const effectiveChatId = chatId || (activeWorkspace.type === 'chat' ? activeWorkspace.id : undefined) || createId('chat');
    const requestId = crypto.randomUUID();
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

    // Register requestId → chatId for event routing.
    requestToChatRef.current.set(requestId, effectiveChatId);
    runningChatIdRef.current = effectiveChatId;
    setStatus('working');
    setLastError(null);

    // Only include history entries with roles accepted by the schema.
    const history = [
      ...(existingChat?.messages || []),
      userMessage
    ]
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    window.electron.freeclaude.send({
      requestId,
      content: prompt,
      history: history.length > 0 ? history : undefined,
      sessionId: existingChat?.sessionId
    });
  }, [activeWorkspace.id, activeWorkspace.type, chats, selectedProjectId]);

  const handleCancel = useCallback(() => {
    // Collect all chatIds that are currently running or queued.
    const chatIdsToFinalize = Array.from(new Set(requestToChatRef.current.values()));
    requestToChatRef.current.clear();

    window.electron.freeclaude.cancel();

    if (chatIdsToFinalize.length > 0) {
      setChats((prev) => prev.map((chat) => {
        if (!chatIdsToFinalize.includes(chat.id)) {
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

  const handleRegenerateAssistant = useCallback(() => {
    if (!activeChat || activeChat.isGenerating) {
      return;
    }
    const last = activeChat.messages[activeChat.messages.length - 1];
    if (last?.role !== 'assistant') {
      return;
    }

    const msgs = activeChat.messages.slice(0, -1);
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      return;
    }

    setChats((prev) => prev.map((chat) => {
      if (chat.id !== activeChat.id) {
        return chat;
      }
      return {
        ...chat,
        messages: msgs,
        isGenerating: true,
        streamingMessage: '',
        lastError: undefined,
        updatedAt: Date.now()
      };
    }));

    const requestId = crypto.randomUUID();
    requestToChatRef.current.set(requestId, activeChat.id);
    runningChatIdRef.current = activeChat.id;
    setStatus('working');
    setLastError(null);

    const history = msgs
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    window.electron.freeclaude.send({
      requestId,
      content: lastUser.content,
      history: history.length > 0 ? history : undefined,
      sessionId: activeChat.sessionId
    });
  }, [activeChat]);

  const handleClearActiveChat = useCallback(() => {
    if (!activeChat) {
      return;
    }
    setChats((prev) => prev.map((chat) => (
      chat.id === activeChat.id
        ? {
            ...chat,
            messages: [],
            streamingMessage: '',
            lastError: undefined,
            draft: '',
            updatedAt: Date.now()
          }
        : chat
    )));
  }, [activeChat]);

  const handleExportChatMarkdown = useCallback(() => {
    if (!activeChat) {
      return;
    }
    const body = activeChat.messages
      .map((m) => `## ${m.role === 'user' ? 'Пользователь' : m.role === 'assistant' ? 'FreeClaude' : 'Система'}\n\n${m.content}\n`)
      .join('\n');
    const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeChat.title.replace(/[^\w\d\-А-Яа-яёЁ]+/gu, '_').slice(0, 48) || 'chat'}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [activeChat]);

  useShellShortcuts({
    enabled: true,
    activeWorkspace,
    onNewChat: handleNewChat,
    onToggleInspector: () => setInspectorOpen((open) => !open),
    onCloseInspector: () => setInspectorOpen(false),
    inspectorOpen,
    homeComposerRef,
    chatComposerRef,
    searchInputRef
  });

  return (
    <div className={`app-shell workspace-${activeWorkspace.type}`}>
      <div className="app-shell-body">
        <NavigationRail
          version={version}
          chats={chatsForSelectedProject}
          projects={projectsWithActivity}
          activeWorkspace={activeWorkspace}
          selectedProjectId={selectedProjectId}
          onNewChat={handleNewChat}
          onSelectWorkspace={handleSelectWorkspace}
          onSelectProject={handleSelectProject}
          onAddProject={handleAddProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          onReorderProjects={handleReorderProjects}
          onDeleteChat={handleDeleteChat}
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
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((open) => !open)}
        />

        <div className="workspace-stack">
          <section className={`workspace-panel ${activeWorkspace.type === 'home' ? 'is-active' : ''}`}>
            <HomeCanvas
              heading={`Что сделаем в ${selectedProject.name}?`}
              subheading="Один поток: запрос, терминал и файлы без потери контекста."
              draft={homeDraft}
              isGenerating={status === 'working' && activeWorkspace.type === 'home'}
              projectLabel={selectedProject.name}
              providerLabel={appConfig.provider.toUpperCase()}
              modelLabel={appConfig.model}
              onDraftChange={setHomeDraft}
              onSend={(value) => submitPrompt(value)}
              onCancel={handleCancel}
              suggestions={homeSuggestions}
              composerRef={homeComposerRef}
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
                composerRef={chatComposerRef}
                onRegenerate={handleRegenerateAssistant}
                providerLabel={appConfig.provider.toUpperCase()}
                modelLabel={appConfig.model}
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
                <span className="conversation-kicker">Глобальный поиск</span>
                <h2>Найдите чат, проект или рабочий сценарий</h2>
                <p>Поиск проходит по названиям чатов, тексту сообщений и карточкам рабочих пространств.</p>
              </div>
              <div className="search-panel" role="search" aria-label="Глобальный поиск по чатам и проектам">
                <div className="search-input-card">
                  <Icon name="search" size={18} />
                  <input
                    ref={searchInputRef}
                    id="global-search-input"
                    aria-label="Поиск по чатам, проектам и рабочим сценариям"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Например: терминал, дорожная карта, провайдер, рефакторинг..."
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
                      <div className="rail-empty">
                        {orderedChats.length === 0 ? 'Нет чатов' : 'Ничего не найдено'}
                      </div>
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
                <span className="conversation-kicker">Провайдеры и интеграции</span>
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
                  meta="Контекст проекта"
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
                <span className="conversation-kicker">Быстрые сценарии</span>
                <h2>Автоматизации и быстрые сценарии</h2>
                <p>Запускайте готовые рабочие потоки без потери доступа к чатам, терминалу и файловому контексту.</p>
              </div>
              <div className="insight-grid insight-grid-three">
                <InsightCard
                  title="Собрать план реализации"
                  meta="Сценарий чата"
                  description="Запускает новый чат с промптом для полного плана и критериев приёмки."
                  actionLabel="Старт"
                  onAction={() => submitPrompt('Собери подробный implementation plan для текущей задачи с этапами, рисками и критериями приемки.')}
                />
                <InsightCard
                  title="Открыть диагностику"
                  meta="Терминал"
                  description="Переключает в терминал для запуска локальных команд и smoke-проверок."
                  actionLabel="Открыть"
                  onAction={() => handleSelectWorkspace({ type: 'terminal' })}
                />
                <InsightCard
                  title="Подготовить файловый контекст"
                  meta="Файлы"
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
                {activeWorkspace.type === 'files' ? (
                  <FileExplorer
                    onFileSelect={(path, content) => setFilePreview({ path, content })}
                  />
                ) : null}
              </div>
              <div className="file-preview-pane">
                {filePreview ? (
                  <>
                    <div className="file-preview-header">
                      <div>
                        <span className="conversation-kicker">Превью файла</span>
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

      {inspectorOpen && (
        <button
          type="button"
          className="inspector-scrim"
          aria-label="Закрыть инспектор"
          onClick={() => setInspectorOpen(false)}
        />
      )}

      <InspectorPanel
        open={inspectorOpen}
        compact={inspectorCompact}
        config={appConfig}
        activeChat={activeWorkspace.type === 'chat' ? activeChat : null}
        diagnostics={
          activeWorkspace.type === 'chat' && activeChat
            ? chatDiagnostics[activeChat.id]
            : undefined
        }
        onClose={() => setInspectorOpen(false)}
        onToggleCompact={() => setInspectorCompact((c) => !c)}
        onClearChat={handleClearActiveChat}
        onExportMarkdown={handleExportChatMarkdown}
        onRenameChat={handleRenameChat}
      />

      <Onboarding />
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
