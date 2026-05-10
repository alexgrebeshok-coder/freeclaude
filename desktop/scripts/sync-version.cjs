#!/usr/bin/env node
'use strict';

/**
 * Keeps `desktop/package.json` version in sync with the root `package.json`.
 *
 * Run modes:
 *   node scripts/sync-version.cjs          # writes desktop/package.json
 *   node scripts/sync-version.cjs --check  # exits 1 if mismatched
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const desktopPkgPath = path.join(__dirname, '..', 'package.json');
const rootPkgPath = path.join(root, 'package.json');

const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
const desktopPkg = JSON.parse(fs.readFileSync(desktopPkgPath, 'utf-8'));

const target = rootPkg.version;
const current = desktopPkg.version;

if (!target) {
  console.error('Root package.json has no "version" field.');
  process.exit(1);
}

const checkOnly = process.argv.includes('--check');

if (current === target) {
  console.log(`desktop version already at ${target}`);
  process.exit(0);
}

if (checkOnly) {
  console.error(`Version mismatch: desktop=${current} root=${target}`);
  process.exit(1);
}

desktopPkg.version = target;
fs.writeFileSync(desktopPkgPath, JSON.stringify(desktopPkg, null, 2) + '\n');
console.log(`desktop version: ${current} -> ${target}`);
