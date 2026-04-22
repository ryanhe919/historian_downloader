import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { RpcCallOptions, RpcEventMap, RpcMethodMap, RpcMethodName } from '@shared/rpc-types'
import type { UpdateCheckResult, UpdateStatusPayload } from '@shared/domain-types'

const Channel = {
  Call: 'hd:rpc:call',
  Event: 'hd:rpc:event',
  SidecarStatus: 'hd:sidecar:status',
  PickFolder: 'hd:dialog:pickFolder',
  OpenPath: 'hd:shell:openPath',
  ShowInFolder: 'hd:shell:showInFolder',
  DefaultExportDir: 'hd:paths:defaultExportDir',
  UpdateCheck: 'hd:update:check',
  UpdateInstall: 'hd:update:install',
  UpdateStatus: 'hd:update:status'
} as const

type Listener<E extends keyof RpcEventMap> = (payload: RpcEventMap[E]) => void

const listeners = new Map<string, Set<(payload: unknown) => void>>()

ipcRenderer.on(Channel.Event, (_e: IpcRendererEvent, payload: unknown) => {
  if (!payload || typeof payload !== 'object') return
  const { method, params } = payload as { method: string; params: unknown }
  const bucket = listeners.get(method)
  if (!bucket) return
  for (const cb of bucket) {
    try {
      cb(params)
    } catch (err) {
      console.error(`[preload] listener for ${method} threw:`, err)
    }
  }
})

ipcRenderer.on(Channel.SidecarStatus, (_e: IpcRendererEvent, payload: unknown) => {
  const bucket = listeners.get('sidecar.statusChanged')
  if (!bucket) return
  for (const cb of bucket) {
    try {
      cb(payload)
    } catch (err) {
      console.error('[preload] sidecar.statusChanged listener threw:', err)
    }
  }
})

function on<E extends keyof RpcEventMap>(event: E, cb: Listener<E>): () => void {
  let bucket = listeners.get(event)
  if (!bucket) {
    bucket = new Set()
    listeners.set(event, bucket)
  }
  bucket.add(cb as (payload: unknown) => void)
  return () => off(event, cb)
}

function off<E extends keyof RpcEventMap>(event: E, cb: Listener<E>): void {
  const bucket = listeners.get(event)
  if (!bucket) return
  bucket.delete(cb as (payload: unknown) => void)
  if (bucket.size === 0) listeners.delete(event)
}

function call<K extends RpcMethodName>(
  method: K,
  params: RpcMethodMap[K]['params'],
  opts?: RpcCallOptions
): Promise<RpcMethodMap[K]['result']> {
  return ipcRenderer.invoke(Channel.Call, method, params, opts) as Promise<
    RpcMethodMap[K]['result']
  >
}

const env = {
  isDev: process.env.NODE_ENV !== 'production',
  rpcMock: process.env.VITE_RPC_MOCK === '1' || process.env.HD_FORCE_MOCK === '1'
}

const api = {
  rpc: { call },
  on,
  off,
  dialog: {
    pickFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null> {
      return ipcRenderer.invoke(Channel.PickFolder, opts) as Promise<string | null>
    }
  },
  shell: {
    openPath(p: string): Promise<string> {
      return ipcRenderer.invoke(Channel.OpenPath, p) as Promise<string>
    },
    showInFolder(p: string): Promise<void> {
      return ipcRenderer.invoke(Channel.ShowInFolder, p) as Promise<void>
    }
  },
  paths: {
    defaultExportDir(): Promise<string> {
      return ipcRenderer.invoke(Channel.DefaultExportDir) as Promise<string>
    }
  },
  update: {
    check(): Promise<UpdateCheckResult> {
      return ipcRenderer.invoke(Channel.UpdateCheck) as Promise<UpdateCheckResult>
    },
    install(): Promise<void> {
      return ipcRenderer.invoke(Channel.UpdateInstall) as Promise<void>
    },
    onStatus(cb: (payload: UpdateStatusPayload) => void): () => void {
      const handler = (_e: IpcRendererEvent, payload: unknown): void => {
        cb(payload as UpdateStatusPayload)
      }
      ipcRenderer.on(Channel.UpdateStatus, handler)
      return () => {
        ipcRenderer.off(Channel.UpdateStatus, handler)
      }
    }
  },
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  appVersion: (() => {
    try {
      return (ipcRenderer.sendSync('hd:app:version') as string) ?? ''
    } catch {
      return ''
    }
  })(),
  env
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('hd', api)
  } catch (err) {
    console.error('[preload] exposeInMainWorld failed:', err)
  }
} else {
  ;(globalThis as unknown as { hd: typeof api }).hd = api
}

export type HdBridge = typeof api
