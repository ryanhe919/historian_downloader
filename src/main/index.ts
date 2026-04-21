import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { initLogger, log } from './logger'
import { createMainWindow } from './window'
import { SidecarSupervisor } from './sidecar/supervisor'
import { RpcClient } from './rpc/client'
import { registerRpcBridge } from './ipc/rpc-bridge'
import { registerDialogHandlers } from './ipc/dialog'
import { registerPathsHandlers } from './ipc/paths'
import { registerShellHandlers } from './ipc/shell'

initLogger()

const supervisor = new SidecarSupervisor()
const rpcClient = new RpcClient()

supervisor.on('ready', (transport) => {
  log.info('[main] sidecar ready, attaching RPC transport')
  rpcClient.attachTransport(transport)
})

supervisor.on('crashed', () => {
  log.warn('[main] sidecar crashed, detaching RPC transport')
  rpcClient.detachTransport()
})

supervisor.on('fatal', ({ error }) => {
  log.error('[main] sidecar fatal, detaching RPC transport:', error.message)
  rpcClient.detachTransport()
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.historian.downloader')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerDialogHandlers()
  registerShellHandlers()
  registerPathsHandlers()
  registerRpcBridge({ client: rpcClient, supervisor })

  supervisor.start()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async (e) => {
  if (supervisor.state === 'stopped') return
  e.preventDefault()
  log.info('[main] stopping sidecar before quit')
  try {
    await supervisor.stop()
  } catch (err) {
    log.warn('[main] sidecar stop failed:', (err as Error).message)
  } finally {
    app.exit(0)
  }
})
