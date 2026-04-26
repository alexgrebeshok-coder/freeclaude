import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { FreeClaudeBridge } from './freeclaude-bridge';
import { TerminalManager } from './terminal';
import { FileManager } from './file-manager';

const isDevelopment = process.env.NODE_ENV === 'development';

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('Another instance is already running');
  app.quit();
  process.exit(0);
}

// App configuration
app.setName('FreeClaude');
app.setAppUserModelId('com.freeclaude.desktop');

// User data path
const userDataPath = path.join(app.getPath('appData'), 'FreeClaude');
app.setPath('userData', userDataPath);

// Ensure directories exist
const configDir = path.join(userDataPath, 'config');
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

let mainWindow: BrowserWindow | null = null;
let freeclaudeBridge: FreeClaudeBridge | null = null;
let terminalManager: TerminalManager | null = null;
let fileManager: FileManager | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  // Load renderer
  if (isDevelopment) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/main_window/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    freeclaudeBridge?.stop();
    terminalManager?.dispose();
  });

  // Handle new window requests
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Initialize services
function initializeServices(): void {
  // FreeClaude CLI Bridge
  freeclaudeBridge = new FreeClaudeBridge();
  freeclaudeBridge.on('message', (data) => {
    mainWindow?.webContents.send('freeclaude:message', data);
  });
  freeclaudeBridge.on('error', (error) => {
    mainWindow?.webContents.send('freeclaude:error', error);
  });

  // Terminal Manager
  terminalManager = new TerminalManager();
  terminalManager.on('data', (id, data) => {
    mainWindow?.webContents.send('terminal:data', { id, data });
  });
  terminalManager.on('exit', (id, code) => {
    mainWindow?.webContents.send('terminal:exit', { id, code });
  });

  // File Manager
  fileManager = new FileManager();
}

// Setup IPC handlers
function setupIPC(): void {
  // Window controls
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });

  // App info
  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  // Shell
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    await shell.openExternal(url);
  });

  // FreeClaude bridge
  ipcMain.handle('freeclaude:send', async (_, message: unknown) => {
    return freeclaudeBridge?.send(message);
  });

  ipcMain.handle('freeclaude:cancel', () => {
    freeclaudeBridge?.cancel();
  });

  // Terminal
  ipcMain.handle('terminal:create', async (_, options) => {
    return terminalManager?.createTerminal(options);
  });

  ipcMain.handle('terminal:write', async (_, id: string, data: string) => {
    terminalManager?.write(id, data);
  });

  ipcMain.handle('terminal:resize', async (_, id: string, cols: number, rows: number) => {
    terminalManager?.resize(id, cols, rows);
  });

  ipcMain.handle('terminal:kill', async (_, id: string) => {
    terminalManager?.kill(id);
  });

  // Dialog
  ipcMain.handle('dialog:openFile', async (_, options) => {
    const result = await dialog.showOpenDialog(mainWindow!, options);
    return result.filePaths;
  });

  ipcMain.handle('dialog:saveFile', async (_, options) => {
    const result = await dialog.showSaveDialog(mainWindow!, options);
    return result.filePath;
  });

  // File operations
  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    return fileManager?.readFile(filePath);
  });

  ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
    return fileManager?.writeFile(filePath, content);
  });

  ipcMain.handle('fs:stat', async (_, filePath: string) => {
    return fileManager?.stat(filePath);
  });

  ipcMain.handle('fs:readdir', async (_, dirPath: string) => {
    return fileManager?.readDir(dirPath);
  });

  // Config
  ipcMain.handle('config:get', (_, key: string) => {
    const configPath = path.join(configDir, 'settings.json');
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config[key];
    } catch {
      return undefined;
    }
  });

  ipcMain.handle('config:set', (_, key: string, value: unknown) => {
    const configPath = path.join(configDir, 'settings.json');
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // Config doesn't exist yet
    }
    config[key] = value;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  });
}

// App event handlers
app.whenReady().then(async () => {
  initializeServices();
  setupIPC();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Delay bridge start to ensure window is ready
  setTimeout(() => {
    freeclaudeBridge?.start();
  }, 1000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (_, contents) => {
  contents.on('new-window', (event) => {
    event.preventDefault();
  });
});
