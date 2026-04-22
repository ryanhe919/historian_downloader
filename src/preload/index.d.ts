import type { RpcCallOptions, RpcEventMap, RpcMethodMap, RpcMethodName } from '@shared/rpc-types'
import type {
  UpdateCheckResult,
  UpdatePhase as SharedUpdatePhase,
  UpdateStatusPayload as SharedUpdateStatusPayload
} from '@shared/domain-types'

// Re-export for backwards-compatible imports from preload; source of truth is shared/.
export type UpdatePhase = SharedUpdatePhase
export type UpdateStatusPayload = SharedUpdateStatusPayload
export type { UpdateCheckResult }

export interface HdRpcApi {
  call<K extends RpcMethodName>(
    method: K,
    params: RpcMethodMap[K]['params'],
    opts?: RpcCallOptions
  ): Promise<RpcMethodMap[K]['result']>
}

export interface HdDialogApi {
  pickFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
}

export interface HdShellApi {
  openPath(p: string): Promise<string>
  showInFolder(p: string): Promise<void>
}

export interface HdPathsApi {
  /**
   * Platform-appropriate default export directory
   * (``~/Downloads/Historian`` on POSIX, ``%USERPROFILE%\\Downloads\\Historian``
   * on Windows). The directory is **not** created by this call.
   */
  defaultExportDir(): Promise<string>
}

export interface HdUpdateApi {
  /** Trigger a manual update check. Rejects in dev mode. */
  check(): Promise<UpdateCheckResult>
  /** Quit the app and install the already-downloaded update. */
  install(): Promise<void>
  /** Subscribe to autoUpdater lifecycle events. Returns an unsubscriber. */
  onStatus(cb: (payload: UpdateStatusPayload) => void): () => void
}

export interface HdEnv {
  isDev: boolean
  rpcMock: boolean
}

export interface HdBridge {
  rpc: HdRpcApi
  on<E extends keyof RpcEventMap>(event: E, cb: (payload: RpcEventMap[E]) => void): () => void
  off<E extends keyof RpcEventMap>(event: E, cb: (payload: RpcEventMap[E]) => void): void
  dialog: HdDialogApi
  shell: HdShellApi
  paths: HdPathsApi
  update: HdUpdateApi
  platform: 'darwin' | 'win32' | 'linux'
  appVersion: string
  env: HdEnv
}

declare global {
  interface Window {
    hd: HdBridge
  }
}

export {}
