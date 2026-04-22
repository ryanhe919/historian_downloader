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
    const pythonDir = join(projectRoot, 'python')
    const entry = join(pythonDir, 'main.py')

    // HD_PYTHON 逃生舱：直接指向某个 python 解释器（venv/pyenv/Anaconda），
    // 跳过 uv。适用于 uv 不在 PATH 或者开发者想手动管控环境的情况。
    if (process.env.HD_PYTHON) {
      return {
        command: process.env.HD_PYTHON,
        args: [entry],
        cwd: projectRoot,
        env
      }
    }

    // 默认走 uv：从 python/pyproject.toml + uv.lock 里解析 venv，
    // 每次 `uv run` 都会按 lockfile 自动同步依赖（首次会解压 .venv，
    // 后续秒启）。Windows 上必须启用 `windows` extra 才会装 pywin32
    // + pymssql，否则 proficy / sqlserver adapter 导入失败退回 mock。
    const uvArgs = ['run', '--project', pythonDir]
    if (process.platform === 'win32') uvArgs.push('--extra', 'windows')
    uvArgs.push('python', entry)
    return {
      command: process.env.HD_UV ?? 'uv',
      args: uvArgs,
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
