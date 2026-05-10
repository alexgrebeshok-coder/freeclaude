'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { findPackagedApp } = require('./find-packaged-app.cjs');

const root = path.join(__dirname, '..');
const src = findPackagedApp(root);

if (!src) {
  console.error(
    'Сборка FreeClaude.app не найдена в out/. Сначала выполните: npm run package'
  );
  process.exit(1);
}

const dest = '/Applications/FreeClaude.app';
let launchPath = dest;
try {
  execFileSync('killall', ['FreeClaude'], { stdio: 'ignore' });
} catch {
  // It is fine if FreeClaude was not running.
}

try {
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true });
  }
  fs.cpSync(src, dest, { recursive: true });

  for (const attr of ['com.apple.quarantine', 'com.apple.provenance']) {
    try {
      execFileSync('xattr', ['-dr', attr, dest], { stdio: 'ignore' });
    } catch {
      // Attribute may not exist or may be protected by the OS.
    }
  }

  try {
    execFileSync('open', ['-R', dest], { stdio: 'ignore' });
  } catch {
    // Finder reveal is optional; direct binary launch below is the reliable path.
  }

  console.log(`Установлено: ${dest}`);
} catch (error) {
  launchPath = src;
  console.warn(
    `Не удалось заменить ${dest}: ${error.message}. Запускаем свежую сборку из out/.`
  );
}

const executable = path.join(launchPath, 'Contents', 'MacOS', 'FreeClaude');
const child = spawn(executable, {
  detached: true,
  stdio: 'ignore'
});
child.unref();
console.log(`Запущено: ${launchPath}`);
