import { BrowserWindow, ipcMain } from 'electron'
import { log } from '../logger'
import type { RpcClient } from '../rpc/client'
import { RpcError } from '../rpc/errors'
import type { SidecarStatusEvent } from '@shared/domain-types'
import type { SidecarSupervisor, SupervisorState } from '../sidecar/supervisor'

export const IpcChannel = {
  Call: 'hd:rpc:call',
  Event: 'hd:rpc:event',
  SidecarStatus: 'hd:sidecar:status'
} as const

interface SerializedRpcError {
  __rpcError: true
  name: string
  code: number
  message: string
  data: unknown
}

function serializeError(err: unknown): SerializedRpcError {
  if (err instanceof RpcError) {
    return {
      __rpcError: true,
      name: err.name,
      code: err.code,
      message: err.message,
      data: err.data
    }
  }
  const e = err as Error
  return {
    __rpcError: true,
    name: e?.name ?? 'Error',
    code: -32000,
    message: e?.message ?? String(err),
    data: undefined
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(channel, payload)
  }
}

export interface RpcBridgeOptions {
  client: RpcClient
  supervisor: SidecarSupervisor
}

export function registerRpcBridge({ client, supervisor }: RpcBridgeOptions): () => void {
  const handler = async (
    _e: Electron.IpcMainInvokeEvent,
    method: unknown,
    params: unknown,
    opts: unknown
  ): Promise<unknown> => {
    if (typeof method !== 'string') {
      throw new RpcError(-32600, 'method must be a string')
    }
    const callOpts =
      opts && typeof opts === 'object' && opts !== null && 'timeoutMs' in opts
        ? { timeoutMs: Number((opts as { timeoutMs?: unknown }).timeoutMs) }
        : {}
    try {
      return await client.callRaw(method, params, callOpts)
    } catch (err) {
      // Electron serializes thrown Errors cleanly; we wrap RpcError into a
      // plain object so preload can rehydrate with .code intact.
      const e = serializeError(err)
      const wrapped = new Error(e.message)
      Object.assign(wrapped, { __rpcError: true, code: e.code, data: e.data })
      throw wrapped
    }
  }

  ipcMain.handle(IpcChannel.Call, handler)

  const onEvent = (payload: { method: string; params: unknown }): void => {
    broadcast(IpcChannel.Event, payload)
  }
  client.on('event', onEvent)

  const onState = (state: SupervisorState): void => {
    const evt: SidecarStatusEvent = { state }
    broadcast(IpcChannel.SidecarStatus, evt)
    // Also fan-out as an RpcEvent so useRpcEvent('sidecar.statusChanged') works.
    broadcast(IpcChannel.Event, { method: 'sidecar.statusChanged', params: evt })
  }
  supervisor.on('state', onState)

  const onFatal = ({ error }: { error: Error }): void => {
    log.error('[rpc-bridge] sidecar fatal:', error.message)
    const evt: SidecarStatusEvent = { state: 'fatal', error: error.message }
    broadcast(IpcChannel.SidecarStatus, evt)
    broadcast(IpcChannel.Event, { method: 'sidecar.statusChanged', params: evt })
  }
  supervisor.on('fatal', onFatal)

  return () => {
    ipcMain.removeHandler(IpcChannel.Call)
    client.off('event', onEvent)
    supervisor.off('state', onState)
    supervisor.off('fatal', onFatal)
  }
}
