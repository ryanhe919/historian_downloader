import { BrowserWindow, dialog, ipcMain } from 'electron'

export const DialogChannel = {
  PickFolder: 'hd:dialog:pickFolder'
} as const

export interface PickFolderOptions {
  title?: string
  defaultPath?: string
}

export function registerDialogHandlers(): () => void {
  ipcMain.handle(
    DialogChannel.PickFolder,
    async (event, opts: PickFolderOptions | undefined): Promise<string | null> => {
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const result = await (parent
        ? dialog.showOpenDialog(parent, {
            title: opts?.title,
            defaultPath: opts?.defaultPath,
            properties: ['openDirectory', 'createDirectory']
          })
        : dialog.showOpenDialog({
            title: opts?.title,
            defaultPath: opts?.defaultPath,
            properties: ['openDirectory', 'createDirectory']
          }))
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    }
  )

  return () => {
    ipcMain.removeHandler(DialogChannel.PickFolder)
  }
}
