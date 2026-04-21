import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'

export interface SidecarCommand {
  command: string
  args: string[]
  cwd?: string
  env: NodeJS.ProcessEnv
}

function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HD_USER_DATA_DIR: app.getPath('userData'),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1'
  }
  if (process.env.HD_FORCE_MOCK !== undefined) {
    env.HD_FORCE_MOCK = process.env.HD_FORCE_MOCK
  }
  return env
}

export function resolveSidecarCommand(): SidecarCommand {
  const env = baseEnv()

  if (is.dev) {
    const projectRoot = process.env.ELECTRON_PROJECT_ROOT ?? app.getAppPath()
    return {
      command: process.env.HD_PYTHON ?? 'python3',
      args: [join(projectRoot, 'python', 'main.py')],
      cwd: projectRoot,
      env
    }
  }

  const isWin = process.platform === 'win32'
  const binaryName = isWin ? 'hd-sidecar.exe' : 'hd-sidecar'
  return {
    command: join(process.resourcesPath, 'hd-sidecar', binaryName),
    args: [],
    env
  }
}
