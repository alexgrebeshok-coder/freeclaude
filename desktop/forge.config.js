'use strict';

const fs = require('fs');
const path = require('path');

function copyPackagedModule(buildPath, moduleName) {
  const source = path.join(__dirname, 'node_modules', moduleName);
  const target = path.join(buildPath, '.vite', 'node_modules', moduleName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

const macSigningIdentity =
  process.env.APPLE_SIGNING_IDENTITY || process.env.MAC_DEVELOPER_ID || null;

const macNotarize =
  process.env.APPLE_ID && (process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD)
    ? {
        appleId: process.env.APPLE_ID,
        appleIdPassword:
          process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID
      }
    : null;

const entitlementsPath = path.join(__dirname, 'build', 'entitlements.mac.plist');
const hasEntitlements = fs.existsSync(entitlementsPath);

const macOsxSign = macSigningIdentity
  ? {
      identity: macSigningIdentity,
      ...(hasEntitlements
        ? {
            optionsForFile: () => ({
              entitlements: entitlementsPath,
              hardenedRuntime: true,
              'gatekeeper-assess': false
            })
          }
        : {})
    }
  : null;

if (process.env.FORGE_DEBUG_SIGN) {
  console.log('[forge.config] macSigningIdentity:', macSigningIdentity);
  console.log('[forge.config] macNotarize:', macNotarize ? 'configured' : 'not configured');
  console.log('[forge.config] entitlements:', hasEntitlements ? entitlementsPath : 'absent');
}

const repoOwner = process.env.GH_RELEASE_OWNER || 'alexgrebeshok-coder';
const repoName = process.env.GH_RELEASE_REPO || 'freeclaude';
const isPrerelease =
  process.env.GH_RELEASE_PRERELEASE === '1' || process.env.GH_RELEASE_PRERELEASE === 'true';

const publishers = process.env.GH_TOKEN
  ? [
      {
        name: '@electron-forge/publisher-github',
        config: {
          repository: { owner: repoOwner, name: repoName },
          prerelease: isPrerelease,
          draft: process.env.GH_RELEASE_DRAFT !== '0',
          tagPrefix: 'desktop-v'
        }
      }
    ]
  : [];

module.exports = {
  packagerConfig: {
    name: 'FreeClaude',
    executableName: 'FreeClaude',
    icon: path.join(__dirname, 'assets/icon.icns'),
    appBundleId: 'com.freeclaude.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    asar: {
      unpack: '**/.vite/node_modules/node-pty/build/Release/spawn-helper'
    },
    osxUniversal: { x64ArchFiles: '*' },
    ...(macOsxSign ? { osxSign: macOsxSign } : {}),
    ...(macNotarize ? { osxNotarize: macNotarize } : {}),
    extendInfo: path.join(__dirname, 'build', 'Info.plist.fragment.plist')
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      copyPackagedModule(buildPath, 'node-pty');
      copyPackagedModule(buildPath, 'node-addon-api');
    }
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'FreeClaude',
        icon: path.join(__dirname, 'assets/icon.icns'),
        format: 'ULFO'
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin']
    }
  ],
  publishers,
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {}
    },
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            entry: path.join(__dirname, 'src/main/bootstrap.ts'),
            config: path.join(__dirname, 'vite.main.config.ts')
          },
          {
            entry: path.join(__dirname, 'src/preload/preload.ts'),
            config: path.join(__dirname, 'vite.preload.config.ts')
          }
        ],
        renderer: [
          {
            name: 'main_window',
            config: path.join(__dirname, 'vite.renderer.config.ts')
          }
        ]
      }
    }
  ]
};
