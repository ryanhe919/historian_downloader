import { ipcMain, shell } from 'electron'

export const ShellChannel = {
  OpenPath: 'hd:shell:openPath',
  ShowInFolder: 'hd:shell:showInFolder'
} as const

export function registerShellHandlers(): () => void {
  ipcMain.handle(ShellChannel.OpenPath, async (_e, p: unknown): Promise<string> => {
    if (typeof p !== 'string' || p.length === 0) {
      throw new Error('path must be a non-empty string')
    }
    return shell.openPath(p)
  })

  ipcMain.handle(ShellChannel.ShowInFolder, async (_e, p: unknown): Promise<void> => {
    if (typeof p !== 'string' || p.length === 0) {
      throw new Error('path must be a non-empty string')
    }
    shell.showItemInFolder(p)
  })

  return () => {
    ipcMain.removeHandler(ShellChannel.OpenPath)
    ipcMain.removeHandler(ShellChannel.ShowInFolder)
  }
}
