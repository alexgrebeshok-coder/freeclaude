/**
 * Preload script — runs in a sandboxed renderer context.
 *
 * IMPORTANT: Only `electron` may be imported at the module level. Everything
 * else (including ipc-contract) is bundled into this file by Vite (see
 * vite.preload.config.ts which only externalizes `electron`). At runtime the
 * only `require()` call emitted is `require('electron')`, keeping the preload
 * sandbox-compatible.
 *
 * `InvokeChannels` is a plain string-constant object with no runtime side-
 * effects; zod is transitively bundled but never executes at module load time.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { EventChannels, InvokeChannels } from '../shared/ipc-contract';

// ---------------------------------------------------------------------------
// Window controls
// ---------------------------------------------------------------------------
const windowAPI = {
  minimize: () => ipcRenderer.invoke(InvokeChannels.windowMinimize),
  maximize: () => ipcRenderer.invoke(InvokeChannels.windowMaximize),
  close: () => ipcRenderer.invoke(InvokeChannels.windowClose)
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const appAPI = {
  getVersion: () => ipcRenderer.invoke(InvokeChannels.appVersion),
  /** Signal to the main process that the React tree has mounted. */
  rendererReady: () => ipcRenderer.invoke(InvokeChannels.appRendererReady),
  getLogPath: () => ipcRenderer.invoke(InvokeChannels.appGetLogPath),
  openLogFolder: () => ipcRenderer.invoke(InvokeChannels.appOpenLogFolder)
};

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
const shellAPI = {
  openExternal: (url: string) => ipcRenderer.invoke(InvokeChannels.shellOpenExternal, url)
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const pathsAPI = {
  home: () => ipcRenderer.invoke(InvokeChannels.pathsHome),
  userData: () => ipcRenderer.invoke(InvokeChannels.pathsUserData)
};

// ---------------------------------------------------------------------------
// FreeClaude bridge
// ---------------------------------------------------------------------------
const freeclaudeAPI = {
  send: (message: unknown) => ipcRenderer.invoke(InvokeChannels.freeclaudeSend, message),
  cancel: () => ipcRenderer.invoke(InvokeChannels.freeclaudeCancel),
  getProviders: () => ipcRenderer.invoke(InvokeChannels.freeclaudeGetProviders),
  getModels: (providerId?: string) => ipcRenderer.invoke(InvokeChannels.freeclaudeGetModels, providerId),
  getResolvedConfig: () => ipcRenderer.invoke(InvokeChannels.freeclaudeGetResolvedConfig),
  onMessage: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data);
    ipcRenderer.on(EventChannels.freeclaudeMessage, handler);
    return () => {
      ipcRenderer.removeListener(EventChannels.freeclaudeMessage, handler);
    };
  },
  onError: (callback: (error: unknown) => void) => {
    const handler = (_: unknown, error: unknown) => callback(error);
    ipcRenderer.on(EventChannels.freeclaudeError, handler);
    return () => {
      ipcRenderer.removeListener(EventChannels.freeclaudeError, handler);
    };
  }
};

// ---------------------------------------------------------------------------
// Provider settings
// ---------------------------------------------------------------------------
const providersAPI = {
  saveConfig: (update: unknown) => ipcRenderer.invoke(InvokeChannels.providerSaveConfig, update),
  setApiKey: (providerId: string, apiKey: string) =>
    ipcRenderer.invoke(InvokeChannels.providerSetApiKey, { providerId, apiKey }),
  clearApiKey: (providerId: string) =>
    ipcRenderer.invoke(InvokeChannels.providerClearApiKey, { providerId }),
  setActive: (providerId: string, model?: string) =>
    ipcRenderer.invoke(InvokeChannels.providerSetActive, { providerId, model }),
  testConnection: (request: unknown) =>
    ipcRenderer.invoke(InvokeChannels.providerTestConnection, request)
};

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------
const terminalAPI = {
  create: (options?: { cwd?: string; shell?: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke(InvokeChannels.terminalCreate, options),
  write: (id: string, data: string) => ipcRenderer.invoke(InvokeChannels.terminalWrite, id, data),
  resize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke(InvokeChannels.terminalResize, id, cols, rows),
  kill: (id: string) => ipcRenderer.invoke(InvokeChannels.terminalKill, id),
  onData: (callback: (id: string, data: string) => void) => {
    const handler = (_: unknown, { id, data }: { id: string; data: string }) => callback(id, data);
    ipcRenderer.on(EventChannels.terminalData, handler);
    return () => {
      ipcRenderer.removeListener(EventChannels.terminalData, handler);
    };
  },
  onExit: (callback: (id: string, code: number) => void) => {
    const handler = (_: unknown, { id, code }: { id: string; code: number }) => callback(id, code);
    ipcRenderer.on(EventChannels.terminalExit, handler);
    return () => {
      ipcRenderer.removeListener(EventChannels.terminalExit, handler);
    };
  }
};

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------
const dialogAPI = {
  openFile: (options?: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke(InvokeChannels.dialogOpenFile, options),
  saveFile: (options?: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke(InvokeChannels.dialogSaveFile, options)
};

// ---------------------------------------------------------------------------
// File system
// ---------------------------------------------------------------------------
const fsAPI = {
  readFile: (filePath: string) => ipcRenderer.invoke(InvokeChannels.fsReadFile, filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke(InvokeChannels.fsWriteFile, filePath, content),
  stat: (filePath: string) => ipcRenderer.invoke(InvokeChannels.fsStat, filePath),
  readDir: (dirPath: string) => ipcRenderer.invoke(InvokeChannels.fsReaddir, dirPath)
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const configAPI = {
  get: (key: string) => ipcRenderer.invoke(InvokeChannels.configGet, key),
  set: (key: string, value: unknown) => ipcRenderer.invoke(InvokeChannels.configSet, key, value)
};

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
const diagnosticsAPI = {
  zip: () => ipcRenderer.invoke(InvokeChannels.diagnosticsZip)
};

// ---------------------------------------------------------------------------
// Expose to renderer via contextBridge
// ---------------------------------------------------------------------------
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  window: windowAPI,
  app: appAPI,
  shell: shellAPI,
  paths: pathsAPI,
  freeclaude: freeclaudeAPI,
  providers: providersAPI,
  terminal: terminalAPI,
  dialog: dialogAPI,
  fs: fsAPI,
  config: configAPI,
  diagnostics: diagnosticsAPI
});

// ---------------------------------------------------------------------------
// Type declarations for renderer
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    electron: {
      platform: NodeJS.Platform | 'browser';
      window: typeof windowAPI;
      app: typeof appAPI;
      shell: typeof shellAPI;
      paths: typeof pathsAPI;
      freeclaude: typeof freeclaudeAPI;
      providers: typeof providersAPI;
      terminal: typeof terminalAPI;
      dialog: typeof dialogAPI;
      fs: typeof fsAPI;
      config: typeof configAPI;
      diagnostics: typeof diagnosticsAPI;
    };
  }
}
