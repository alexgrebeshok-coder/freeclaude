module.exports = {
  packagerConfig: {
    name: 'FreeClaude',
    executableName: 'FreeClaude',
    icon: 'assets/icon.icns',
    appBundleId: 'com.freeclaude.desktop',
    asar: true
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'FreeClaude',
        icon: 'assets/icon.icns'
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
            entry: 'src/main/bootstrap.ts',
            config: 'vite.main.config.ts'
          },
          {
            entry: 'src/preload/preload.ts',
            config: 'vite.preload.config.ts'
          }
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.ts'
          }
        ]
      }
    }
  ]
};
