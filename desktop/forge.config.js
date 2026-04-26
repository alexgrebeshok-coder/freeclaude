const path = require('path');

module.exports = {
  packagerConfig: {
    name: 'FreeClaude',
    executableName: 'FreeClaude',
    icon: path.join(__dirname, 'assets/icon.icns'),
    appBundleId: 'com.freeclaude.desktop',
    asar: true
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
