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
        activeProvider: null,
        activeModel: null,
        providers: [],
        configPath: '~/.freeclaude.json',
        cliPath: null,
        cliSource: null
      }),
      getModels: async () => [],
      getResolvedConfig: async () => ({
        provider: '',
        model: '',
        apiKey: '',
        cliPath: null,
        cliSource: null,
        localConfigPath: '~/.freeclaude.json',
        desktopConfigPath: ''
      }),
      onMessage: () => noop,
      onError: () => noop
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
