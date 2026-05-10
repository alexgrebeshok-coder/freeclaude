'use strict';

const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { findPackagedApp } = require('./find-packaged-app.cjs');

const root = path.join(__dirname, '..');
const appPath = findPackagedApp(root);

if (!appPath) {
  console.error(
    'Сборка FreeClaude.app не найдена в out/. Сначала выполните: npm run package'
  );
  process.exit(1);
}

function launchExecutable(appBundlePath) {
  const executable = path.join(appBundlePath, 'Contents', 'MacOS', 'FreeClaude');
  const child = spawn(executable, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

if (process.platform === 'darwin') {
  try {
    // Prefer Launch Services: activates an existing instance and brings it forward.
    execFileSync('open', [appPath], { stdio: 'inherit' });
  } catch (error) {
    console.warn('open не смог запустить .app; пробуем прямой запуск бинарника.');
    launchExecutable(appPath);
  }
} else {
  launchExecutable(appPath);
}
console.log(`Запущено: ${appPath}`);
