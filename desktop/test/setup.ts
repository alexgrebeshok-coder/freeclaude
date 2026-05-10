import '@testing-library/jest-dom/vitest';

/**
 * Global test setup for vitest.
 *
 * - Loads jest-dom matchers so `expect(element).toBeInTheDocument()` works.
 * - Stubs `window.matchMedia` so components that listen for
 *   `prefers-color-scheme` and `prefers-reduced-motion` don't crash under jsdom.
 * - Stubs the Electron preload bridge with permissive no-ops so renderer
 *   tests can render `App.tsx` without a real Electron host.
 */

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  } as unknown as MediaQueryList);
}

if (typeof window !== 'undefined' && !window.electron) {
  const noop = (): void => {};
  const noopAsync = async (): Promise<void> => {};

  window.electron = {
    platform: 'browser',
    window: { minimize: noopAsync, maximize: noopAsync, close: noopAsync },
    app: {
      getVersion: async () => 'test',
      rendererReady: noopAsync,
      getLogPath: async () => '',
      openLogFolder: noopAsync
    },
    shell: { openExternal: noopAsync },
    paths: { home: async () => '/Users/test', userData: async () => '' },
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
      create: async () => 'test-terminal',
      write: noopAsync,
      resize: noopAsync,
      kill: noopAsync,
      onData: () => noop,
      onExit: () => noop
    },
    dialog: { openFile: async () => [], saveFile: async () => undefined },
    fs: {
      readFile: async () => '',
      writeFile: noopAsync,
      stat: async () => ({}) as Record<string, unknown>,
      readDir: async () => []
    },
    config: { get: async () => undefined, set: noopAsync },
    diagnostics: { zip: async () => ({ ok: false }) }
  };
}
