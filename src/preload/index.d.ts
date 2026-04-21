import type { RpcCallOptions, RpcEventMap, RpcMethodMap, RpcMethodName } from '@shared/rpc-types'

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
