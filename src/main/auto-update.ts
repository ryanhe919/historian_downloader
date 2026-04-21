/**
 * Windows-only auto-update integration.
 *
 * Runs a single `checkForUpdatesAndNotify` pass after the main window
 * appears. The app is unsigned today, so electron-updater's signature
 * comparison is a no-op (both old and new exe lack a publisher cert);
 * each install still triggers Windows SmartScreen once until we ship
 * an EV code-signing cert.
 *
 * macOS / Linux are skipped because (a) the product is Windows-only
 * (Historian OLE DB / pymssql) and (b) Squirrel.Mac requires Developer
 * ID signing which we don't have.
 */
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log/main'

export function initAutoUpdate(): void {
  if (process.platform !== 'win32') return
  if (is.dev) return

  // Route updater logs into the same electron-log file as everything else.
  autoUpdater.logger = log
  // Don't silently force-install; the default `checkForUpdatesAndNotify`
  // downloads in the background and prompts the user on next quit.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  app.whenReady().then(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      log.warn('[auto-update] check failed:', (err as Error).message)
    })
  })
}
