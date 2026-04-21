import { create } from 'zustand'

export type RuntimeStatus = 'connected' | 'testing' | 'failed'

interface ConnectionState {
  selectedServerId: string | null
  setSelectedServerId: (id: string | null) => void
  /**
   * In-session overlay of per-server connection status. Takes precedence over
   * the `server.status` field returned by the sidecar, which reflects the
   * last persisted result (often `offline` right after creation and confuses
   * users who haven't actually run a test yet). Cleared when the app reloads.
   */
  runtimeStatus: Map<string, RuntimeStatus>
  setRuntimeStatus: (id: string, status: RuntimeStatus) => void
  clearRuntimeStatus: (id: string) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  selectedServerId: null,
  setSelectedServerId: (id) => set({ selectedServerId: id }),
  runtimeStatus: new Map(),
  setRuntimeStatus: (id, status) =>
    set((s) => {
      const next = new Map(s.runtimeStatus)
      next.set(id, status)
      return { runtimeStatus: next }
    }),
  clearRuntimeStatus: (id) =>
    set((s) => {
      if (!s.runtimeStatus.has(id)) return {}
      const next = new Map(s.runtimeStatus)
      next.delete(id)
      return { runtimeStatus: next }
    })
}))
