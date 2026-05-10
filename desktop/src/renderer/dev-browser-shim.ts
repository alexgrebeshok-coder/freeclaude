/**
 * Vite serves the renderer at http://localhost:3000 for quick UI checks.
 * Outside Electron, preload does not run, so install minimal stubs for
 * preview-only flows. All stubs mirror the real preload surface so the
 * renderer never throws on missing APIs.
 */
function install(): void {
  if (typeof window === 'undefined' || window.electron) {
    return;
  }

  const noop = (): void => {};
  const noopAsync = async (): Promise<void> => {};

  window.electron = {
    platform: 'browser',
    window: {
      minimize: noopAsync,
      maximize: noopAsync,
      close: noopAsync
    },
    app: {
      getVersion: async () => 'browser-preview',
      rendererReady: noopAsync,
      getLogPath: async () => '',
      openLogFolder: noopAsync
    },
    shell: {
      openExternal: async (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
    paths: {
      home: async () => '/Users/preview',
      userData: async () => ''
    },
    freeclaude: {
      send: noopAsync,
      cancel: noopAsync,
      getProviders: async () => ({
        configured: false,
        activeProvider: 'zai',
        activeModel: 'glm-5.1',
        providers: [],
        configPath: '',
        localConfigPath: '~/.freeclaude.json',
        cliPath: null,
        cliSource: null,
        encryptionAvailable: true
      }),
      getModels: async () => [],
      getResolvedConfig: async () => ({
        provider: 'zai',
        model: 'glm-5.1',
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        apiKeyConfigured: false,
        apiKeyLast4: undefined,
        providerShort: 'ZAI',
        cliPath: null,
        cliSource: null,
        localConfigPath: '~/.freeclaude.json',
        desktopConfigPath: ''
      }),
      onMessage: () => noop,
      onError: () => noop
    },
    providers: {
      saveConfig: async () => ({}),
      setApiKey: async () => ({ configured: true, encrypted: true, last4: 'demo' }),
      clearApiKey: async () => ({ configured: false, encrypted: false }),
      setActive: async () => ({}),
      testConnection: async () => ({ ok: true, message: 'Preview mode' })
    },
    terminal: {
      create: async () => 'browser-preview-terminal',
      write: noopAsync,
      resize: noopAsync,
      kill: noopAsync,
      onData: () => noop,
      onExit: () => noop
    },
    dialog: {
      openFile: async () => [],
      saveFile: async () => undefined
    },
    fs: {
      readFile: async () => '',
      writeFile: noopAsync,
      stat: async () => ({}) as Record<string, unknown>,
      readDir: async () => []
    },
    config: {
      get: async () => undefined,
      set: noopAsync
    },
    diagnostics: {
      zip: async () => ({ ok: false })
    }
  };
}

install();
