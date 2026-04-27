const fs = require('fs');
const path = require('path');

const copyPackagedModule = (buildPath, moduleName) => {
  const source = path.join(__dirname, 'node_modules', moduleName);
  const target = path.join(buildPath, '.vite', 'node_modules', moduleName);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
};

module.exports = {
  packagerConfig: {
    name: 'FreeClaude',
    executableName: 'FreeClaude',
    icon: path.join(__dirname, 'assets/icon.icns'),
    appBundleId: 'com.freeclaude.desktop',
    asar: {
      unpack: '**/.vite/node_modules/node-pty/build/Release/spawn-helper'
    }
  },
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
        icon: path.join(__dirname, 'assets/icon.icns')
      }
    },
    {
      name: '@electron-forge/maker-zip'
    }
  ],
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
