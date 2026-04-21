import type { RpcCallOptions, RpcEventMap, RpcMethodMap, RpcMethodName } from '@shared/rpc-types'

export async function call<K extends RpcMethodName>(
  method: K,
  params: RpcMethodMap[K]['params'],
  opts?: RpcCallOptions
): Promise<RpcMethodMap[K]['result']> {
  return window.hd.rpc.call(method, params, opts)
}

export function on<E extends keyof RpcEventMap>(
  event: E,
  cb: (payload: RpcEventMap[E]) => void
): () => void {
  return window.hd.on(event, cb)
}

export function off<E extends keyof RpcEventMap>(
  event: E,
  cb: (payload: RpcEventMap[E]) => void
): void {
  window.hd.off(event, cb)
}

export interface RpcError extends Error {
  code?: number
  data?: unknown
}

export function isRpcError(e: unknown): e is RpcError {
  return e instanceof Error && typeof (e as RpcError).code === 'number'
}
