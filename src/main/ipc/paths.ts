import path from 'node:path'
import { app, ipcMain } from 'electron'

export const PathsChannel = {
  DefaultExportDir: 'hd:paths:defaultExportDir'
} as const

/**
 * Return the platform-appropriate default export directory.
 *
 * We root under Electron's ``downloads`` path (``~/Downloads`` on macOS /
 * Linux, ``%USERPROFILE%\\Downloads`` on Windows) and append a
 * ``Historian`` subfolder. The directory is **not** created here — the
 * sidecar is responsible for creating/probing it at enqueue time (see
 * ``services.writers.ensure_output_dir``). Returning a path without the
 * side effect keeps this handler safe to call on every DownloadStep mount
 * and avoids races with the renderer's own "pick folder" flow.
 */
function defaultExportDir(): string {
  return path.join(app.getPath('downloads'), 'Historian')
}

export function registerPathsHandlers(): () => void {
  ipcMain.handle(PathsChannel.DefaultExportDir, (): string => defaultExportDir())

  return () => {
    ipcMain.removeHandler(PathsChannel.DefaultExportDir)
  }
}
