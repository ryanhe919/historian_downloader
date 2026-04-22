import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { log } from '../logger'
import { LineTransport } from '../rpc/line-transport'
import { resolveSidecarCommand } from './resolve-binary'

export type SupervisorState = 'stopped' | 'starting' | 'ready' | 'crashed' | 'fatal'

const BACKOFF_SCHEDULE_MS = [1000, 2000, 4000, 8000, 30000]
const MAX_RESTART_ATTEMPTS = BACKOFF_SCHEDULE_MS.length

export interface SupervisorEvents {
  ready: (transport: LineTransport) => void
  crashed: (info: { code: number | null; signal: NodeJS.Signals | null }) => void
  fatal: (info: { error: Error }) => void
  state: (state: SupervisorState) => void
  stderr: (line: string) => void
}

export class SidecarSupervisor extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private transport: LineTransport | null = null
  private _state: SupervisorState = 'stopped'
  private restartAttempts = 0
  private restartTimer: NodeJS.Timeout | null = null
  private stopped = true
  private sidecarLog: WriteStream | null = null

  get state(): SupervisorState {
    return this._state
  }

  /**
   * Lazily open a plaintext `sidecar.log` next to the main electron-log
   * file, for archiving python-side stderr and lifecycle events.  This
   * makes production crashes diagnosable without having to grep
   * `main.log` for interleaved `[sidecar:stderr]` lines.
   *
   * Path: `<userData>/logs/sidecar.log`
   *   — Windows: %APPDATA%\historiandownloader\logs\sidecar.log
   *   — macOS:   ~/Library/Application Support/historiandownloader/logs/sidecar.log
   */
  private getSidecarLog(): WriteStream {
    if (this.sidecarLog) return this.sidecarLog
    const logsDir = join(app.getPath('userData'), 'logs')
    try {
      mkdirSync(logsDir, { recursive: true })
    } catch {
      // best-effort; createWriteStream will surface the real error
    }
    this.sidecarLog = createWriteStream(join(logsDir, 'sidecar.log'), { flags: 'a' })
    return this.sidecarLog
  }

  private writeSidecarLog(line: string): void {
    try {
      this.getSidecarLog().write(`${new Date().toISOString()} ${line}\n`)
    } catch {
      // never let logging crash supervision
    }
  }

  private setState(next: SupervisorState): void {
    if (this._state === next) return
    this._state = next
    this.emit('state', next)
  }

  start(): void {
    this.stopped = false
    this.spawnOnce()
  }

  private spawnOnce(): void {
    if (this.stopped) return
    const cmd = resolveSidecarCommand()
    const cmdline = `${cmd.command} ${cmd.args.join(' ')}`
    log.info(`[sidecar] spawn: ${cmdline}`)
    this.writeSidecarLog(`=== SPAWN ${cmdline} (cwd=${cmd.cwd ?? '<default>'}) ===`)
    this.setState('starting')

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(cmd.command, cmd.args, {
        cwd: cmd.cwd,
        env: cmd.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (err) {
      const msg = (err as Error).message
      log.error('[sidecar] spawn threw:', msg)
      this.writeSidecarLog(`=== SPAWN_THREW ${msg} ===`)
      this.scheduleRestart(err as Error)
      return
    }

    this.child = child

    child.once('spawn', () => {
      log.info(`[sidecar] pid=${child.pid} running`)
      this.writeSidecarLog(`=== RUNNING pid=${child.pid} ===`)
    })

    const transport = new LineTransport(child.stdout, child.stdin)
    this.transport = transport

    createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', (line) => {
      log.info(`[sidecar:stderr] ${line}`)
      this.writeSidecarLog(`[stderr] ${line}`)
      this.emit('stderr', line)
    })

    child.on('error', (err) => {
      log.error('[sidecar] process error:', err.message)
      this.writeSidecarLog(`=== PROCESS_ERROR ${err.message} ===`)
    })

    child.on('exit', (code, signal) => {
      log.warn(`[sidecar] exit code=${code} signal=${signal}`)
      this.writeSidecarLog(`=== EXIT code=${code} signal=${signal ?? 'null'} ===`)
      this.transport?.close()
      this.transport = null
      this.child = null
      this.emit('crashed', { code, signal })
      if (this.stopped) {
        this.setState('stopped')
        return
      }
      this.scheduleRestart(new Error(`sidecar exited code=${code} signal=${signal ?? ''}`))
    })

    // Signal readiness as soon as the transport is wired; actual
    // `system.ready` notification flows through the RpcClient to the UI.
    this.restartAttempts = 0
    this.setState('ready')
    this.emit('ready', transport)
  }

  private scheduleRestart(reason: Error): void {
    if (this.stopped) return
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      log.error(`[sidecar] exhausted ${MAX_RESTART_ATTEMPTS} restarts — giving up`)
      this.setState('fatal')
      this.emit('fatal', { error: reason })
      return
    }
    const delay = BACKOFF_SCHEDULE_MS[this.restartAttempts] ?? 30_000
    this.restartAttempts += 1
    log.warn(`[sidecar] restart attempt ${this.restartAttempts} in ${delay}ms`)
    this.setState('crashed')
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnOnce()
    }, delay)
  }

  sendLine(line: string): void {
    if (!this.child?.stdin) return
    this.child.stdin.write(line.endsWith('\n') ? line : line + '\n', 'utf8')
  }

  onLine(cb: (line: string) => void): void {
    if (!this.transport) return
    this.transport.onMessage((msg) => cb(JSON.stringify(msg)))
  }

  async stop(timeoutMs = 2000): Promise<void> {
    this.stopped = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    if (!child) {
      this.setState('stopped')
      return
    }
    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
        resolve()
      }, timeoutMs)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.setState('stopped')
  }
}
