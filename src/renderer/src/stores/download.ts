import { create } from 'zustand'
import type { ExportFormat, ExportTask } from '@shared/domain-types'

interface DownloadState {
  format: ExportFormat
  /**
   * Absolute output directory. Empty on first launch — DownloadStep
   * resolves it to the Electron ``downloads`` path on mount so we never
   * store a literal ``~`` (which earlier caused a ``~/Historian/Exports``
   * folder to appear under the project root).
   */
  outputDir: string
  tasks: Record<string, ExportTask>
  setFormat: (f: ExportFormat) => void
  setOutputDir: (p: string) => void
  upsertTask: (task: ExportTask) => void
  removeTask: (taskId: string) => void
  replaceTasks: (tasks: ExportTask[]) => void
}

export const useDownloadStore = create<DownloadState>((set) => ({
  format: 'CSV',
  outputDir: '',
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
