/**
 * Windows-only auto-update integration.
 *
 * Flow:
 *   1. On app ready: register IPC channels + event forwarding, and silently
 *      kick off one background check. If an update is found, electron-updater
 *      downloads it automatically and will install on next quit.
 *   2. The renderer (帮助 → 检查更新) can at any time invoke `hd:update:check`
 *      to trigger a fresh check; all lifecycle events are broadcast via
 *      `hd:update:status` so the UI can show "checking / available /
 *      not-available / downloading / downloaded / error" feedback.
 *   3. On "downloaded", the renderer may offer a "立即重启并安装" button
 *      that calls `hd:update:install` → quitAndInstall.
 *
 * The app is currently unsigned, so each install trips Windows SmartScreen
 * once until an EV code-signing cert is in place.
 *
 * macOS / Linux are skipped — the product is Windows-only (Historian OLE DB
 * / pymssql) and Squirrel.Mac requires Apple Developer ID signing we don't
 * have.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import log from 'electron-log/main'
import type { UpdateCheckResult, UpdateStatusPayload } from '@shared/domain-types'

export const UpdateChannel = {
  Check: 'hd:update:check',
  Install: 'hd:update:install',
  Status: 'hd:update:status'
} as const

function broadcast(payload: UpdateStatusPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(UpdateChannel.Status, payload)
  }
}

function extractNotes(info: UpdateInfo): string | null {
  const notes = info.releaseNotes
  if (notes == null) return null
  if (typeof notes === 'string') return notes
  // electron-updater can return an array of { note, version } on GitHub.
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (typeof n === 'string' ? n : (n.note ?? '')))
      .filter(Boolean)
      .join('\n\n')
  }
  return null
}

export function initAutoUpdate(): void {
  if (process.platform !== 'win32') return

  // Route updater logs into the same electron-log file as everything else.
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // ---- Event forwarding to the renderer ----
  autoUpdater.on('checking-for-update', () => {
    broadcast({ phase: 'checking' })
  })
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    broadcast({
      phase: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: extractNotes(info)
    })
  })
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    broadcast({
      phase: 'not-available',
      version: info.version,
      releaseDate: info.releaseDate
    })
  })
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    broadcast({
      phase: 'downloading',
      progress: {
        percent: p.percent,
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total
      }
    })
  })
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    broadcast({
      phase: 'downloaded',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: extractNotes(info)
    })
  })
  autoUpdater.on('error', (err) => {
    log.warn('[auto-update] error:', err.message)
    broadcast({ phase: 'error', error: err.message })
  })

  // ---- IPC handlers ----
  ipcMain.handle(UpdateChannel.Check, async (): Promise<UpdateCheckResult> => {
    if (is.dev) {
      throw new Error('自动更新在开发模式下不可用（仅打包后的版本支持）')
    }
    try {
      const r = await autoUpdater.checkForUpdates()
      if (!r) {
        return { updateAvailable: false }
      }
      // `r.updateInfo.version` vs `app.getVersion()` decides whether a new
      // version actually exists (electron-updater resolves regardless).
      const current = app.getVersion()
      const remote = r.updateInfo?.version
      const updateAvailable = !!remote && remote !== current
      return {
        updateAvailable,
        version: remote,
        releaseDate: r.updateInfo?.releaseDate,
        releaseNotes: r.updateInfo ? extractNotes(r.updateInfo) : null
      }
    } catch (err) {
      const message = (err as Error).message
      log.warn('[auto-update] manual check failed:', message)
      // Re-throw so the renderer's try/catch surfaces a real error toast.
      throw new Error(message)
    }
  })

  ipcMain.handle(UpdateChannel.Install, (): void => {
    if (is.dev) return
    log.info('[auto-update] quitAndInstall requested')
    // isSilent=false so the NSIS installer shows progress; isForceRunAfter=true
    // re-launches the app after installation.
    autoUpdater.quitAndInstall(false, true)
  })

  // Kick off the silent startup check once, outside of the IPC call.
  if (!is.dev) {
    app.whenReady().then(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        log.warn('[auto-update] startup check failed:', (err as Error).message)
      })
    })
  }
}
