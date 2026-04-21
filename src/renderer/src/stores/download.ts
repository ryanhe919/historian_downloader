import { create } from 'zustand'
import type { ExportFormat, ExportTask } from '@shared/domain-types'

interface DownloadState {
  format: ExportFormat
  outputDir: string
  tasks: Record<string, ExportTask>
  setFormat: (f: ExportFormat) => void
  setOutputDir: (p: string) => void
  upsertTask: (task: ExportTask) => void
  removeTask: (taskId: string) => void
  replaceTasks: (tasks: ExportTask[]) => void
}

const defaultOutputDir = (): string => {
  if (typeof window !== 'undefined' && window.hd) {
    return window.hd.platform === 'win32' ? 'D:\\Historian\\Exports' : '~/Historian/Exports'
  }
  return '~/Historian/Exports'
}

export const useDownloadStore = create<DownloadState>((set) => ({
  format: 'CSV',
  outputDir: defaultOutputDir(),
  tasks: {},
  setFormat: (f) => set({ format: f }),
  setOutputDir: (p) => set({ outputDir: p }),
  upsertTask: (task) => set((s) => ({ tasks: { ...s.tasks, [task.id]: task } })),
  removeTask: (taskId) =>
    set((s) => {
      const next = { ...s.tasks }
      delete next[taskId]
      return { tasks: next }
    }),
  replaceTasks: (tasks) => set({ tasks: Object.fromEntries(tasks.map((t) => [t.id, t])) })
}))
