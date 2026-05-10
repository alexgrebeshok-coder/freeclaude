declare module 'electron-squirrel-startup' {
  /**
   * Returns `true` if the current process was started as the Squirrel.Windows
   * installer/uninstaller helper. The main process should call `app.quit()`
   * immediately in that case to let Squirrel finish.
   *
   * The package has no published type definitions; this shim mirrors the
   * runtime contract documented in
   * https://github.com/mongodb-js/electron-squirrel-startup
   */
  const handleSquirrel: boolean;
  export = handleSquirrel;
}
