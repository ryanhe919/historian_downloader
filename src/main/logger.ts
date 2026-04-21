import { is } from '@electron-toolkit/utils'
import log from 'electron-log/main'

let initialized = false

export function initLogger(): typeof log {
  if (initialized) return log
  initialized = true

  log.initialize()
  log.transports.file.level = 'info'
  log.transports.console.level = is.dev ? 'debug' : 'warn'

  return log
}

export { log }
