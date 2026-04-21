import { ErrorCode } from '@shared/error-codes'

export class RpcError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.data = data
  }

  toJSON(): { name: string; code: number; message: string; data: unknown } {
    return { name: this.name, code: this.code, message: this.message, data: this.data }
  }
}

export class SidecarRestartedError extends RpcError {
  constructor(message = 'sidecar restarted') {
    super(ErrorCode.SIDECAR_RESTARTED, message)
    this.name = 'SidecarRestartedError'
  }
}

export class RpcTimeoutError extends RpcError {
  constructor(method: string, timeoutMs: number) {
    super(ErrorCode.INTERNAL, `rpc call "${method}" timed out after ${timeoutMs}ms`)
    this.name = 'RpcTimeoutError'
  }
}

export class RpcTransportError extends RpcError {
  constructor(message: string) {
    super(ErrorCode.INTERNAL, message)
    this.name = 'RpcTransportError'
  }
}

export function isRpcError(value: unknown): value is RpcError {
  return value instanceof RpcError
}
