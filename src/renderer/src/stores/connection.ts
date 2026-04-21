import { create } from 'zustand'

interface ConnectionState {
  selectedServerId: string | null
  setSelectedServerId: (id: string | null) => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  selectedServerId: null,
  setSelectedServerId: (id) => set({ selectedServerId: id })
}))
