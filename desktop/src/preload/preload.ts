import { contextBridge, ipcRenderer } from 'electron';

type IPCChannel =
  | 'window:minimize'
  | 'window:maximize'
  | 'window:close'
  | 'app:version'
  | 'shell:openExternal'
  | 'freeclaude:send'
  | 'freeclaude:cancel'
  | 'terminal:create'
  | 'terminal:write'
  | 'terminal:resize'
  | 'terminal:kill'
  | 'dialog:openFile'
  | 'dialog:saveFile'
  | 'fs:readFile'
  | 'fs:writeFile'
  | 'fs:stat'
  | 'fs:readdir'
  | 'config:get'
  | 'config:set';

// Window controls
const windowAPI = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close')
};

// App info
const appAPI = {
  getVersion: () => ipcRenderer.invoke('app:version')
};

// Shell
const shellAPI = {
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
};

// FreeClaude bridge
const freeclaudeAPI = {
  send: (message: unknown) => ipcRenderer.invoke('freeclaude:send', message),
  cancel: () => ipcRenderer.invoke('freeclaude:cancel'),
  onMessage: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data);
    ipcRenderer.on('freeclaude:message', handler);
    return () => ipcRenderer.removeListener('freeclaude:message', handler);
  },
  onError: (callback: (error: unknown) => void) => {
    const handler = (_: unknown, error: unknown) => callback(error);
    ipcRenderer.on('freeclaude:error', handler);
    return () => ipcRenderer.removeListener('freeclaude:error', handler);
  }
};

// Terminal
const terminalAPI = {
  create: (options?: { cwd?: string; shell?: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke('terminal:create', options),
  write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
  resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
  onData: (callback: (id: string, data: string) => void) => {
    const handler = (_: unknown, { id, data }: { id: string; data: string }) => callback(id, data);
    ipcRenderer.on('terminal:data', handler);
    return () => ipcRenderer.removeListener('terminal:data', handler);
  },
  onExit: (callback: (id: string, code: number) => void) => {
    const handler = (_: unknown, { id, code }: { id: string; code: number }) => callback(id, code);
    ipcRenderer.on('terminal:exit', handler);
    return () => ipcRenderer.removeListener('terminal:exit', handler);
  }
};

// Dialog
const dialogAPI = {
  openFile: (options?: Electron.OpenDialogOptions) => ipcRenderer.invoke('dialog:openFile', options),
  saveFile: (options?: Electron.SaveDialogOptions) => ipcRenderer.invoke('dialog:saveFile', options)
};

// File system
const fsAPI = {
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  stat: (filePath: string) => ipcRenderer.invoke('fs:stat', filePath),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readdir', dirPath)
};

// Config
const configAPI = {
  get: (key: string) => ipcRenderer.invoke('config:get', key),
  set: (key: string, value: unknown) => ipcRenderer.invoke('config:set', key, value)
};

// Expose APIs to renderer
contextBridge.exposeInMainWorld('electron', {
  window: windowAPI,
  app: appAPI,
  shell: shellAPI,
  freeclaude: freeclaudeAPI,
  terminal: terminalAPI,
  dialog: dialogAPI,
  fs: fsAPI,
  config: configAPI
});

// Type declarations for renderer
declare global {
  interface Window {
    electron: {
      window: typeof windowAPI;
      app: typeof appAPI;
      shell: typeof shellAPI;
      freeclaude: typeof freeclaudeAPI;
      terminal: typeof terminalAPI;
      dialog: typeof dialogAPI;
      fs: typeof fsAPI;
      config: typeof configAPI;
    };
  }
}
