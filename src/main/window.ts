import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'
import icon from '../../resources/icon.png?asset'

// Production: strict. Dev: relax script/connect so Vite HMR (inline
// react-refresh shim, ws connection, dynamic eval) can actually run.
const PROD_CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:"
].join('; ')

const DEV_CSP = [
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:*",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*",
  "connect-src 'self' http://localhost:* ws://localhost:*",
  "img-src 'self' data: http://localhost:*",
  "font-src 'self' data:"
].join('; ')

export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'

  // Windows: use the OS-native frame (standard ─/□/× controls). macOS: hide
  // the title bar but keep the native traffic lights via `hiddenInset`. Linux:
  // default frame. Without this, Windows users had a frameless window whose
  // self-drawn traffic dots weren't wired up — no way to close/minimize.
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...(details.responseHeaders ?? {}) }
    headers['Content-Security-Policy'] = [is.dev ? DEV_CSP : PROD_CSP]
    callback({ responseHeaders: headers })
  })

  // Pipe renderer console into the main log so we can diagnose without
  // having to open DevTools. Only in dev — prod keeps the renderer silent.
  if (is.dev) {
    win.webContents.on('console-message', (e) => {
      const levelName = ['verbose', 'info', 'warning', 'error'][e.level] ?? 'log'
      console.log(`[renderer:${levelName}] ${e.message}`)
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error('[renderer] process gone:', details)
    })
    win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, url) => {
      console.error(`[renderer] did-fail-load ${errorCode} ${errorDescription} ${url}`)
    })
    win.webContents.openDevTools({ mode: 'detach' })
  }

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
