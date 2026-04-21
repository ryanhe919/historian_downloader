import type { Readable, Writable } from 'node:stream'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { RpcTransportError } from './errors'

const MAX_LINE_BYTES = 1024 * 1024 // 1 MiB per line (see rpc-contract §0.1)

export type LineMessageHandler = (message: unknown) => void
export type LineErrorHandler = (err: Error) => void

/**
 * Thin line-delimited JSON transport. Writes `JSON.stringify(obj) + \n` to the
 * given writable stream, and parses one line at a time from the readable.
 * 1 MiB per-line cap; anything larger is a protocol violation.
 */
export class LineTransport {
  private readonly input: Readable
  private readonly output: Writable
  private readline?: ReadlineInterface
  private messageHandler?: LineMessageHandler
  private errorHandler?: LineErrorHandler
  private closed = false

  constructor(input: Readable, output: Writable) {
    this.input = input
    this.output = output
    this.attach()
  }

  private attach(): void {
    this.input.setEncoding('utf8')
    this.readline = createInterface({
      input: this.input,
      crlfDelay: Infinity,
      terminal: false
    })

    this.readline.on('line', (line) => {
      if (this.closed) return
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
        this.errorHandler?.(new RpcTransportError(`incoming line exceeds ${MAX_LINE_BYTES} bytes`))
        return
      }
      if (line.length === 0) return
      try {
        const parsed = JSON.parse(line) as unknown
        this.messageHandler?.(parsed)
      } catch (err) {
        this.errorHandler?.(new RpcTransportError(`invalid JSON line: ${(err as Error).message}`))
      }
    })

    this.readline.on('close', () => {
      if (this.closed) return
      this.errorHandler?.(new RpcTransportError('transport input closed'))
    })

    this.input.on('error', (err) => {
      this.errorHandler?.(new RpcTransportError(`input stream error: ${err.message}`))
    })

    this.output.on('error', (err) => {
      this.errorHandler?.(new RpcTransportError(`output stream error: ${err.message}`))
    })
  }

  onMessage(cb: LineMessageHandler): void {
    this.messageHandler = cb
  }

  onError(cb: LineErrorHandler): void {
    this.errorHandler = cb
  }

  write(obj: unknown): void {
    if (this.closed) throw new RpcTransportError('transport closed')
    const serialized = JSON.stringify(obj)
    const encoded = Buffer.byteLength(serialized, 'utf8')
    if (encoded > MAX_LINE_BYTES) {
      throw new RpcTransportError(`outgoing message exceeds ${MAX_LINE_BYTES} bytes`)
    }
    this.output.write(serialized + '\n', 'utf8')
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.readline?.close()
  }
}
