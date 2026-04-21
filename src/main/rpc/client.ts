import { EventEmitter } from 'node:events'
import type {
  JsonRpcFailure,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccess,
  RpcCallOptions,
  RpcMethodMap,
  RpcMethodName
} from '@shared/rpc-types'
import { log } from '../logger'
import type { LineTransport } from './line-transport'
import { RpcError, RpcTimeoutError, SidecarRestartedError } from './errors'

const DEFAULT_TIMEOUT_MS = 30_000

interface Pending {
  method: string
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: NodeJS.Timeout
}

export interface RpcClientEvents {
  event: (payload: { method: string; params: unknown }) => void
  notification: (msg: JsonRpcNotification) => void
}

/**
 * JSON-RPC 2.0 client that talks over a LineTransport. The transport is
 * injected so SidecarSupervisor can swap it after a sidecar restart.
 */
export class RpcClient extends EventEmitter {
  private transport: LineTransport | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  attachTransport(transport: LineTransport): void {
    this.detachTransport(new SidecarRestartedError('transport replaced'))
    this.transport = transport
    transport.onMessage((msg) => this.handleMessage(msg))
    transport.onError((err) => {
      log.warn('[rpc] transport error:', err.message)
    })
  }

  detachTransport(reason: Error = new SidecarRestartedError()): void {
    if (this.transport) {
      this.transport.close()
      this.transport = null
    }
    this.failAllPending(reason)
  }

  private failAllPending(reason: Error): void {
    const snapshot = Array.from(this.pending.entries())
    this.pending.clear()
    for (const [, entry] of snapshot) {
      clearTimeout(entry.timer)
      entry.reject(reason)
    }
  }

  async call<K extends RpcMethodName>(
    method: K,
    params: RpcMethodMap[K]['params'],
    opts: RpcCallOptions = {}
  ): Promise<RpcMethodMap[K]['result']> {
    return this.callRaw(method, params, opts) as Promise<RpcMethodMap[K]['result']>
  }

  async callRaw(method: string, params: unknown, opts: RpcCallOptions = {}): Promise<unknown> {
    if (!this.transport) {
      throw new SidecarRestartedError('sidecar not connected')
    }
    const id = this.nextId++
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params })
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new RpcTimeoutError(method, timeoutMs))
        }
      }, timeoutMs)
      this.pending.set(id, { method, resolve, reject, timer })
      try {
        this.transport?.write(request)
      } catch (err) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(err)
      }
    })
  }

  notify(method: string, params?: unknown): void {
    if (!this.transport) return
    const msg: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params === undefined ? {} : { params })
    }
    try {
      this.transport.write(msg)
    } catch (err) {
      log.warn('[rpc] notify failed:', (err as Error).message)
    }
  }

  private handleMessage(raw: unknown): void {
    if (!raw || typeof raw !== 'object') {
      log.warn('[rpc] dropping non-object message')
      return
    }
    const msg = raw as JsonRpcMessage
    if ('id' in msg && msg.id !== undefined && msg.id !== null && !('method' in msg)) {
      this.handleResponse(msg as JsonRpcSuccess | JsonRpcFailure)
      return
    }
    if ('method' in msg && (!('id' in msg) || msg.id === undefined)) {
      this.handleNotification(msg as JsonRpcNotification)
      return
    }
    // Server-initiated request not currently supported; log and ignore.
    log.warn('[rpc] unsupported message shape:', msg)
  }

  private handleResponse(msg: JsonRpcSuccess | JsonRpcFailure): void {
    const id = msg.id
    if (typeof id !== 'number') {
      log.warn('[rpc] response missing numeric id, dropping')
      return
    }
    const pending = this.pending.get(id)
    if (!pending) {
      log.warn(`[rpc] late response for id=${id} dropped`)
      return
    }
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if ('error' in msg) {
      pending.reject(new RpcError(msg.error.code, msg.error.message, msg.error.data))
    } else {
      pending.resolve(msg.result)
    }
  }

  private handleNotification(msg: JsonRpcNotification): void {
    this.emit('notification', msg)
    this.emit('event', { method: msg.method, params: msg.params })
  }

  pendingCount(): number {
    return this.pending.size
  }
}
