import { app, BrowserWindow, ipcMain, dialog, shell, crashReporter } from 'electron';
import http from 'http';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { FreeClaudeBridge } from './freeclaude-bridge';
import { TerminalManager } from './terminal';
import { FileManager } from './file-manager';
import { getLogger } from './logger';
import { setupAutoUpdater } from './updater';
import {
  InvokeChannels,
  EventChannels,
  EventSchemas,
  InvokeSchemas,
  IpcContractError,
  parseInvoke,
  validateEvent,
  type EventChannel,
  type InvokeChannel
} from '../shared/ipc-contract';
import type { ZodTypeAny } from 'zod';

// ---------------------------------------------------------------------------
// Logger — available immediately so crash handlers can write to it
// ---------------------------------------------------------------------------
const logger = getLogger();
const log = logger.scoped('bootstrap');

// ---------------------------------------------------------------------------
// Crash reporter — local-only dumps; Track E may flip uploadToServer later
// ---------------------------------------------------------------------------
crashReporter.start({ submitURL: '', uploadToServer: false, compress: true });

// ---------------------------------------------------------------------------
// Process-level error handlers
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err: Error) => {
  logger.fatal('uncaught-exception', err);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('unhandled-rejection', { reason });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEV_RENDERER_URL = 'http://127.0.0.1:3000/';
const forgeDevServerUrl = process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL;
const isDevelopment = Boolean(forgeDevServerUrl) || process.env.NODE_ENV === 'development';

function toUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function devServerCandidates(preferredUrl: string): string[] {
  const parsed = toUrl(preferredUrl);
  if (!parsed) {
    return [DEV_RENDERER_URL];
  }

  const candidates: string[] = [];
  const addCandidate = (host: string) => {
    const candidate = new URL(parsed.toString());
    candidate.hostname = host;
    candidates.push(candidate.toString());
  };

  addCandidate(parsed.hostname);
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    addCandidate('127.0.0.1');
    addCandidate('localhost');
  }

  return [...new Set(candidates)];
}

function isAllowedDevNavigation(url: string): boolean {
  return devServerCandidates(forgeDevServerUrl || DEV_RENDERER_URL).some((devUrl) => url.startsWith(devUrl));
}

/** Forge starts Vite before Electron, but the main bundle can win the race; wait until the advertised port answers. */
function waitForDevServer(urls: string[], maxAttempts = 20, intervalMs = 250): Promise<string | null> {
  const pingOnce = (url: string): Promise<boolean> =>
    new Promise((resolvePing) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolvePing(true);
      });
      req.on('error', () => resolvePing(false));
      req.setTimeout(1500, () => {
        req.destroy();
        resolvePing(false);
      });
    });

  return (async () => {
    for (let i = 0; i < maxAttempts; i++) {
      const results = await Promise.all(urls.map(async (url) => ({ url, ok: await pingOnce(url) })));
      const reachable = results.find((result) => result.ok);
      if (reachable) {
        return reachable.url;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  })();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function rendererRecoveryDataUrl(message: string, detail: string): string {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>FreeClaude renderer failed</title>
    <style>
      body { margin: 0; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111827; color: #f9fafb; }
      main { max-width: 720px; padding: 48px; }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { color: #d1d5db; line-height: 1.5; }
      pre { white-space: pre-wrap; background: #030712; border: 1px solid #374151; border-radius: 8px; padding: 16px; color: #fca5a5; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(message)}</h1>
      <p>FreeClaude could not load the renderer. Check the Vite dev server port and restart the desktop app.</p>
      <pre>${escapeHtml(detail)}</pre>
    </main>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function loadRecoveryPage(win: BrowserWindow, message: string, detail: string): Promise<void> {
  rendererLoadFailed = true;
  if (win.isDestroyed()) {
    return;
  }
  try {
    await win.loadURL(rendererRecoveryDataUrl(message, detail));
  } catch (err) {
    log.error('failed-to-load-recovery-page', err);
  }
  revealMainWindow(win);
}

async function loadDevelopmentRenderer(win: BrowserWindow, preferredUrl: string): Promise<void> {
  const candidates = devServerCandidates(preferredUrl);
  const reachableUrl = await waitForDevServer(candidates);
  if (!reachableUrl) {
    const detail = [
      `Preferred URL: ${preferredUrl}`,
      `Tried: ${candidates.join(', ')}`,
      'Vite did not respond on the advertised port. If the renderer started on a different port, stop it or set MAIN_WINDOW_VITE_DEV_SERVER_URL to the matching URL.'
    ].join('\n');
    log.error('dev-server-not-ready', { preferredUrl, candidates });
    await loadRecoveryPage(win, 'Renderer dev server is not reachable', detail);
    return;
  }
  if (win.isDestroyed()) {
    return;
  }
  try {
    await win.loadURL(reachableUrl);
  } catch (err) {
    log.error('failed-to-load-dev-renderer', err);
    await loadRecoveryPage(
      win,
      'Renderer failed to load',
      `URL: ${reachableUrl}\n${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }
  win.webContents.openDevTools();
}

// ---------------------------------------------------------------------------
// Single instance lock (skip while developing)
// ---------------------------------------------------------------------------
const skipSingleInstanceLock = isDevelopment || !app.isPackaged;
const gotTheLock = skipSingleInstanceLock || app.requestSingleInstanceLock();
if (!gotTheLock) {
  log.info('another-instance-running: quitting');
  app.quit();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// App configuration
// ---------------------------------------------------------------------------
app.setName('FreeClaude');
app.setAppUserModelId('com.freeclaude.desktop');

const userDataPath = path.join(app.getPath('appData'), 'FreeClaude');
app.setPath('userData', userDataPath);

const configDir = path.join(userDataPath, 'config');
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

const SENSITIVE_CONFIG_KEYS = new Set(['apiKey', 'api_key', 'providerConfigs']);

function isSensitiveConfigKey(key: unknown): key is string {
  return typeof key === 'string' && SENSITIVE_CONFIG_KEYS.has(key);
}

// ---------------------------------------------------------------------------
// Service instances
// ---------------------------------------------------------------------------
let mainWindow: BrowserWindow | null = null;
let freeclaudeBridge: FreeClaudeBridge | null = null;
let terminalManager: TerminalManager | null = null;
let fileManager: FileManager | null = null;

// ---------------------------------------------------------------------------
// Renderer-ready handshake
// Replaces the old setTimeout(1000). The renderer calls app:rendererReady when
// its React tree has mounted. If it never calls within 5 s, we fall back.
// ---------------------------------------------------------------------------
let rendererReadyResolve: (() => void) | null = null;
let rendererLoadFailed = false;
const rendererReadyPromise = new Promise<void>((resolve) => {
  rendererReadyResolve = resolve;
});

// ---------------------------------------------------------------------------
// IPC validation helper
// ---------------------------------------------------------------------------
/**
 * Wrap an ipcMain.handle call so every invocation is validated by
 * parseInvoke before reaching the handler. Malformed payloads are rejected
 * with { ok: false, error } instead of crashing.
 */
function ipcHandle(channel: InvokeChannel, handler: (...args: unknown[]) => unknown): void {
  const schema = (InvokeSchemas as Record<string, ZodTypeAny>)[channel];
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const parsed: unknown = parseInvoke(channel, schema, args);
      const parsedArgs: unknown[] = Array.isArray(parsed) ? parsed : [];
      return await (handler(...parsedArgs) as Promise<unknown>);
    } catch (err) {
      if (err instanceof IpcContractError) {
        log.warn('ipc-invalid-payload', { channel, error: err.message });
        return { ok: false, error: err.message };
      }
      log.error('ipc-handler-error', { channel, error: err instanceof Error ? err.message : String(err) });
      return { ok: false, error: 'internal error' };
    }
  });
}

function sendRendererEvent(channel: EventChannel, payload: unknown): void {
  const schema = (EventSchemas as Record<string, ZodTypeAny>)[channel];
  const validated = validateEvent(channel, schema, payload, (err) => {
    log.warn('ipc-invalid-event-payload', { channel, error: err.message });
  });
  mainWindow?.webContents.send(channel, validated);
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------
function revealMainWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }
}

function createWindow(): void {
  rendererLoadFailed = false;
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
      // sandbox: true ensures the renderer and preload run in a sandboxed
      // process with no direct Node.js access. The preload uses only
      // contextBridge + ipcRenderer from electron (no Node built-ins), so
      // it is compatible with sandbox mode.
      sandbox: true
    },
    show: false
  });

  const prodIndexHtml = path.join(__dirname, '../renderer/main_window/index.html');

  if (isDevelopment) {
    void loadDevelopmentRenderer(mainWindow, forgeDevServerUrl || DEV_RENDERER_URL);
  } else {
    mainWindow.loadFile(prodIndexHtml);
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      revealMainWindow(mainWindow);
    }
  });

  mainWindow.webContents.once('did-finish-load', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (!mainWindow.isVisible()) {
      revealMainWindow(mainWindow);
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    rendererLoadFailed = true;
    log.error('renderer-did-fail-load', { errorCode, errorDescription, validatedURL });
    if (mainWindow && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'FreeClaude',
        message: 'Не удалось загрузить интерфейс',
        detail: `${errorDescription}\n${validatedURL || ''}`
      });
      revealMainWindow(mainWindow);
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    log.warn('renderer-unresponsive');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    freeclaudeBridge?.stop();
    terminalManager?.dispose();
  });
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
function initializeServices(): void {
  freeclaudeBridge = new FreeClaudeBridge();
  freeclaudeBridge.on('message', (data) => {
    sendRendererEvent(EventChannels.freeclaudeMessage, data);
  });
  freeclaudeBridge.on('error', (error) => {
    sendRendererEvent(EventChannels.freeclaudeError, error);
  });

  terminalManager = new TerminalManager();
  terminalManager.on('data', (id, data) => {
    sendRendererEvent(EventChannels.terminalData, { id, data });
  });
  terminalManager.on('exit', (id, code) => {
    sendRendererEvent(EventChannels.terminalExit, { id, code });
  });

  // FileManager restricts all paths to os.homedir() by default
  fileManager = new FileManager();
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
function setupIPC(): void {
  // -- Window controls --
  ipcHandle(InvokeChannels.windowMinimize, () => {
    mainWindow?.minimize();
  });

  ipcHandle(InvokeChannels.windowMaximize, () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcHandle(InvokeChannels.windowClose, () => {
    mainWindow?.close();
  });

  // -- App --
  ipcHandle(InvokeChannels.appVersion, () => app.getVersion());

  /**
   * Renderer calls this after its React tree has mounted. This resolves the
   * rendererReadyPromise which starts the FreeClaude bridge (replacing the
   * old setTimeout(1000) approach).
   */
  ipcHandle(InvokeChannels.appRendererReady, () => {
    if (rendererLoadFailed) {
      log.warn('renderer-ready-ignored-after-load-failure');
      return;
    }
    log.info('renderer-ready-handshake-received');
    rendererReadyResolve?.();
    rendererReadyResolve = null;
  });

  ipcHandle(InvokeChannels.appGetLogPath, () => logger.getFilePath());

  ipcHandle(InvokeChannels.appOpenLogFolder, () => {
    shell.showItemInFolder(logger.getFilePath());
  });

  // -- Shell --
  // URL is already validated by ShellOpenExternalRequestSchema (https/mailto only)
  ipcHandle(InvokeChannels.shellOpenExternal, async (url) => {
    await shell.openExternal(url as string);
  });

  // -- Paths --
  ipcHandle(InvokeChannels.pathsHome, () => os.homedir());
  ipcHandle(InvokeChannels.pathsUserData, () => app.getPath('userData'));

  // -- FreeClaude bridge --
  ipcHandle(InvokeChannels.freeclaudeSend, async (message) => {
    return freeclaudeBridge?.send(message);
  });

  ipcHandle(InvokeChannels.freeclaudeCancel, () => {
    freeclaudeBridge?.cancel();
  });

  ipcHandle(InvokeChannels.freeclaudeGetProviders, () => freeclaudeBridge?.getProvidersInfo());

  ipcHandle(InvokeChannels.freeclaudeGetModels, (providerId) => {
    return freeclaudeBridge?.getModels(providerId as string | undefined);
  });

  ipcHandle(InvokeChannels.freeclaudeGetResolvedConfig, () => freeclaudeBridge?.getResolvedConfig());

  ipcHandle(InvokeChannels.providerSaveConfig, (update) => {
    return freeclaudeBridge?.saveProviderConfig(update as Parameters<FreeClaudeBridge['saveProviderConfig']>[0]);
  });

  ipcHandle(InvokeChannels.providerSetApiKey, (request) => {
    const { providerId, apiKey } = request as { providerId: string; apiKey: string };
    return freeclaudeBridge?.setProviderApiKey(providerId, apiKey);
  });

  ipcHandle(InvokeChannels.providerClearApiKey, (request) => {
    const { providerId } = request as { providerId: string };
    return freeclaudeBridge?.clearProviderApiKey(providerId);
  });

  ipcHandle(InvokeChannels.providerSetActive, (request) => {
    const { providerId, model } = request as { providerId: string; model?: string };
    return freeclaudeBridge?.setActiveProvider(providerId, model);
  });

  ipcHandle(InvokeChannels.providerTestConnection, (request) => {
    return freeclaudeBridge?.testProviderConnection(
      request as Parameters<FreeClaudeBridge['testProviderConnection']>[0]
    );
  });

  // -- Terminal --
  ipcHandle(InvokeChannels.terminalCreate, async (options) => {
    return terminalManager?.createTerminal(
      options as { cwd?: string; shell?: string; cols?: number; rows?: number } | undefined
    );
  });

  ipcHandle(InvokeChannels.terminalWrite, (id, data) => {
    terminalManager?.write(id as string, data as string);
  });

  ipcHandle(InvokeChannels.terminalResize, (id, cols, rows) => {
    terminalManager?.resize(id as string, cols as number, rows as number);
  });

  ipcHandle(InvokeChannels.terminalKill, (id) => {
    terminalManager?.kill(id as string);
  });

  // -- Dialog --
  ipcHandle(InvokeChannels.dialogOpenFile, async (options) => {
    const result = await dialog.showOpenDialog(
      mainWindow!,
      (options as Electron.OpenDialogOptions) ?? {}
    );
    return result.filePaths;
  });

  ipcHandle(InvokeChannels.dialogSaveFile, async (options) => {
    const result = await dialog.showSaveDialog(
      mainWindow!,
      (options as Electron.SaveDialogOptions) ?? {}
    );
    return result.filePath;
  });

  // -- File system --
  ipcHandle(InvokeChannels.fsReadFile, async (filePath) => {
    return fileManager?.readFile(filePath as string);
  });

  ipcHandle(InvokeChannels.fsWriteFile, async (filePath, content) => {
    return fileManager?.writeFile(filePath as string, content as string);
  });

  ipcHandle(InvokeChannels.fsStat, async (filePath) => {
    return fileManager?.stat(filePath as string);
  });

  ipcHandle(InvokeChannels.fsReaddir, async (dirPath) => {
    return fileManager?.readDir(dirPath as string);
  });

  // -- Config --
  ipcHandle(InvokeChannels.configGet, (key) => {
    if (isSensitiveConfigKey(key)) {
      log.warn('blocked-sensitive-config-read', { key });
      return undefined;
    }
    const configPath = path.join(configDir, 'settings.json');
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      return config[key as string];
    } catch {
      return undefined;
    }
  });

  ipcHandle(InvokeChannels.configSet, (key, value) => {
    if (isSensitiveConfigKey(key)) {
      log.warn('blocked-sensitive-config-write', { key });
      return { ok: false, error: 'Sensitive provider settings must use secure provider IPC.' };
    }
    const configPath = path.join(configDir, 'settings.json');
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      // Config doesn't exist yet
    }
    config[key as string] = value;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  });

  // -- Diagnostics --
  // Stub: Track E will implement the actual zip generation.
  ipcHandle(InvokeChannels.diagnosticsZip, () => {
    return { ok: false, error: 'not-implemented' };
  });
}

// ---------------------------------------------------------------------------
// App event handlers
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  initializeServices();
  setupIPC();

  // Security: intercept all WebContents creation to enforce navigation policy
  // and prevent new windows. This catches the main window plus any future windows.
  app.on('web-contents-created', (_event, contents) => {
    // Deny all new-window / window.open calls; allowlisted URLs are opened
    // via shell.openExternal instead.
    contents.setWindowOpenHandler(({ url }) => {
      const isAllowed = /^https?:\/\//i.test(url) || /^mailto:/i.test(url);
      if (isAllowed) {
        void shell.openExternal(url);
      } else {
        log.warn('blocked-window-open', { url });
      }
      return { action: 'deny' };
    });

    // Prevent the renderer from navigating away from its origin.
    // In dev: allow the Vite dev server URL.
    // In prod: allow file:// only.
    contents.on('will-navigate', (event, url) => {
      const isAllowed = isDevelopment ? isAllowedDevNavigation(url) : url.startsWith('file://');
      if (!isAllowed) {
        log.warn('blocked-navigation', { url });
        event.preventDefault();
      }
    });
  });

  // Crash / lifecycle handlers
  app.on('render-process-gone', (_event, _wc, details) => {
    log.error('renderer-gone', details);
  });

  createWindow();

  // Renderer-ready handshake: start the bridge when the renderer signals it
  // is mounted, or after a 5-second fallback if the handshake never arrives.
  const fallbackTimer = setTimeout(() => {
    if (rendererLoadFailed) {
      log.warn('renderer-ready-timeout-after-load-failure: bridge not started');
      return;
    }
    if (rendererReadyResolve) {
      log.warn('renderer-ready-timeout: bridge starting without handshake');
      rendererReadyResolve();
      rendererReadyResolve = null;
    }
  }, 5000);

  void rendererReadyPromise.then(() => {
    clearTimeout(fallbackTimer);
    log.info('bridge-starting');
    freeclaudeBridge?.start();
    // Schedule auto-update checks (no-op in dev / unsigned builds).
    setupAutoUpdater(() => mainWindow);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    revealMainWindow(mainWindow);
    return;
  }
  createWindow();
});
