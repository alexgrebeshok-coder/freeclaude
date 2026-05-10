import path from 'node:path';
import fs from 'node:fs';
import { _electron as electron, expect, test } from '@playwright/test';

/**
 * Smoke E2E: the packaged main bundle starts, opens a window, and the
 * renderer reports `app:rendererReady` (which is the new handshake added in
 * P1). We assert the window becomes visible and exposes the FreeClaude
 * preload surface.
 *
 * Run after `npm run package` (or in CI, after the matrix `make` step). If
 * the build artefact isn't present we skip rather than fail — that lets
 * developers run `vitest` without first packaging.
 */
const bootstrapPath = path.resolve(__dirname, '..', '.vite', 'build', 'bootstrap.js');
const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...electronEnv } = process.env;

test.describe('FreeClaude Desktop launch', () => {
  test.skip(!fs.existsSync(bootstrapPath), 'Run `npm run package` first to produce .vite/build/bootstrap.js');

  test('main window becomes visible and exposes the preload bridge', async () => {
    const app = await electron.launch({
      args: [bootstrapPath],
      env: {
        ...electronEnv,
        NODE_ENV: 'test',
        FREECLAUDE_LOG_LEVEL: 'warn'
      },
      timeout: 30_000
    });

    try {
      const window = await app.firstWindow({ timeout: 30_000 });
      await window.waitForLoadState('domcontentloaded');

      const isVisible = await app.evaluate(({ BrowserWindow }) => {
        const all = BrowserWindow.getAllWindows();
        return all.length > 0 && all[0].isVisible();
      });
      expect(isVisible).toBe(true);

      const preloadShape = await window.evaluate(() => {
        const surface = (window as unknown as { electron?: Record<string, unknown> }).electron;
        if (!surface) return null;
        return Object.keys(surface).sort();
      });

      expect(preloadShape).not.toBeNull();
      expect(preloadShape).toEqual(
        expect.arrayContaining(['app', 'config', 'dialog', 'freeclaude', 'fs', 'shell', 'terminal', 'window'])
      );
    } finally {
      await app.close();
    }
  });
});
