#!/usr/bin/env node
/**
 * Sidecar smoke test — boots the PyInstaller-frozen `hd-sidecar(.exe)`,
 * waits for `system.ready` on stdout, THEN sends a `system.ping` request
 * and verifies a response comes back with the matching id. Both
 * directions of the stdio pipe must work for the test to pass.
 *
 * Why the ping round-trip matters:
 *   v0.1.0 shipped a sidecar that happily emitted `system.ready` but
 *   could not read stdin (Windows asyncio ProactorEventLoop +
 *   inherited Electron pipe HANDLE fired `WinError 6` inside
 *   `_loop_reading` — a callback, not the await path, so the existing
 *   try/except couldn't catch it). The renderer got "sidecar not
 *   connected" on every RPC call. The old CI smoke test passed
 *   because it only scraped stdout. Sending a request forces us to
 *   exercise the stdin → handler → stdout loop end-to-end.
 *
 * Usage:
 *   node scripts/sidecar-smoke-test.mjs [exe-path]
 *
 *   Defaults to `resources/hd-sidecar/hd-sidecar(.exe)` relative to cwd.
 *   Timeout in ms via env var HD_SMOKE_TIMEOUT_MS (default 20000).
 *
 * Exits non-zero (and prints a diagnostic reason) on any failure.
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { statSync } from 'node:fs'

const defaultExe = resolve(
  process.cwd(),
  'resources',
  'hd-sidecar',
  process.platform === 'win32' ? 'hd-sidecar.exe' : 'hd-sidecar'
)
const exePath = resolve(process.argv[2] ?? defaultExe)
const timeoutMs = Number.parseInt(process.env.HD_SMOKE_TIMEOUT_MS ?? '20000', 10)
const requestId = 42

try {
  const stat = statSync(exePath)
  if (!stat.isFile()) throw new Error('not a regular file')
  console.log(`sidecar exe: ${exePath} (${stat.size} bytes)`)
} catch (err) {
  console.error(`sidecar exe missing or invalid: ${exePath} — ${err.message}`)
  process.exit(1)
}

const child = spawn(exePath, [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }
})

child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')

let ready = false
let pinged = false
let pingResp = false
let stdoutBuf = ''
let stderrBuf = ''
let finished = false

child.stdout.on('data', (chunk) => {
  stdoutBuf += chunk
  let idx
  while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, idx).replace(/\r$/, '').trim()
    stdoutBuf = stdoutBuf.slice(idx + 1)
    if (!line) continue
    console.log(`[sidecar-stdout] ${line}`)
    if (!ready && line.includes('"method":"system.ready"')) {
      ready = true
      const req = `{"jsonrpc":"2.0","id":${requestId},"method":"system.ping","params":{}}\n`
      console.log(`[test] -> ${req.trim()}`)
      child.stdin.write(req, 'utf8')
      pinged = true
      continue
    }
    if (pinged && new RegExp(`"id"\\s*:\\s*${requestId}\\b`).test(line)) {
      pingResp = true
      finish(true)
      return
    }
  }
})

child.stderr.on('data', (chunk) => {
  stderrBuf += chunk
})

child.on('error', (err) => finish(false, `spawn error: ${err.message}`))
child.on('exit', (code, signal) => {
  if (finished) return
  finish(false, `sidecar exited prematurely code=${code} signal=${signal ?? ''}`)
})

const timer = setTimeout(
  () =>
    finish(
      false,
      `timeout after ${timeoutMs}ms; ready=${ready} pinged=${pinged} pingResp=${pingResp}`
    ),
  timeoutMs
)

/**
 * @param {boolean} ok
 * @param {string | undefined} reason
 * @returns {void}
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function finish(ok, reason) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  if (!child.killed && child.exitCode === null) {
    try {
      child.stdin.end()
    } catch {
      /* ignore */
    }
    // Give Python a beat to shut down cleanly before SIGKILL.
    setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
      }
    }, 500)
  }
  if (stderrBuf) {
    console.log('[sidecar-stderr]')
    console.log(stderrBuf.trimEnd())
  }
  if (ok) {
    console.log('sidecar smoke test passed (ready + ping round-trip)')
    process.exit(0)
  } else {
    console.error(`sidecar smoke test failed: ${reason}`)
    process.exit(1)
  }
}
