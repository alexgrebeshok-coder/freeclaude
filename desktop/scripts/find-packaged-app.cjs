'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Locates FreeClaude.app produced by `electron-forge package` under ./out.
 */
function findPackagedApp(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'out', 'FreeClaude-darwin-arm64', 'FreeClaude.app'),
    path.join(projectRoot, 'out', 'FreeClaude-darwin-x64', 'FreeClaude.app')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

module.exports = { findPackagedApp };
