import { app, BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { EventChannels } from '../shared/ipc-contract';
import { getLogger } from './logger';

/**
 * Auto-update wiring against the GitHub Releases feed.
 *
 * Strategy:
 *   - macOS: Squirrel.Mac via electron-updater. Requires the app to be signed
 *     and notarized; the unsigned dev build silently skips updates so we don't
 *     show errors locally.
 *   - Telemetry-aware: respects the `telemetryEnabled` desktop config flag,
 *     but checks always run because we treat update metadata as functional,
 *     not analytics.
 *
 * UX:
 *   - On startup (after a short delay) and every 4 hours we call `checkForUpdates()`.
 *   - Progress / status updates are pushed to the renderer over
 *     `updater:status` (see `EventChannels.updaterStatus`). The renderer
 *     surfaces "Restart to update" when a build is downloaded.
 *   - The renderer can call IPC `app:rendererReady` (already wired) before
 *     we begin checks, so the user sees a fully-loaded UI first.
 */

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 10_000;

let scheduled = false;

export function setupAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  const log = getLogger().scoped('updater');

  // The dev build is never auto-updated.
  if (!app.isPackaged) {
    log.info('skip-dev-build');
    return;
  }

  if (scheduled) {
    return;
  }
  scheduled = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (msg) => log.info(String(msg)),
    warn: (msg) => log.warn(String(msg)),
    error: (msg) => log.error(String(msg)),
    debug: (msg) => log.debug(String(msg))
  };

  const send = (payload: unknown): void => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(EventChannels.updaterStatus, payload);
    }
  };

  autoUpdater.on('checking-for-update', () => {
    send({ status: 'checking' });
  });
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log.info('update-available', { version: info.version });
    send({ status: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    send({ status: 'not-available' });
  });
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    send({ status: 'downloading', percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log.info('update-downloaded', { version: info.version });
    send({ status: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err: Error) => {
    // Common in dev / unsigned builds; still log for triage.
    log.error('updater-error', err);
    send({ status: 'error', message: err.message });
  });

  const trigger = (): void => {
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      log.warn('check-failed', err instanceof Error ? err.message : String(err));
    });
  };

  setTimeout(trigger, STARTUP_DELAY_MS);
  setInterval(trigger, FOUR_HOURS_MS);
}

/**
 * Renderer-triggered "restart now" handler. Wired into IPC by the caller.
 */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall(false, true);
}
