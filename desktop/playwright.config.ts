import { defineConfig } from '@playwright/test';

/**
 * Playwright Electron E2E config.
 *
 * Tests live in `desktop/e2e/`. Each spec spawns the *built* main process
 * via `_electron.launch({ args: ['.vite/build/bootstrap.js'] })` so the
 * harness mirrors what end-users see after `npm run package`.
 *
 * Use `npm run test:e2e` to run everything; CI runs the same command on
 * macOS-13/14 in `.github/workflows/desktop.yml`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  }
});
