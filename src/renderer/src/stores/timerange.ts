import { create } from 'zustand'
import type { SamplingMode, TimeRange } from '@shared/domain-types'
import type { PresetId } from '@/lib/time'

interface TimeRangeState {
  activePreset: PresetId
  customRange: TimeRange | null
  sampling: SamplingMode
  segmentDays: number
  setPreset: (p: PresetId) => void
  setCustomRange: (r: TimeRange | null) => void
  setSampling: (s: SamplingMode) => void
  setSegmentDays: (n: number) => void
  /** Reset every Step-2 field back to the factory defaults. */
  reset: () => void
}

const DEFAULT_STATE: {
  activePreset: PresetId
  customRange: TimeRange | null
  sampling: SamplingMode
  segmentDays: number
} = {
  activePreset: 'last-y',
  customRange: null,
  sampling: '1m',
  segmentDays: 10
}

export const useTimeRangeStore = create<TimeRangeState>((set) => ({
  ...DEFAULT_STATE,
  setPreset: (p) => set({ activePreset: p }),
  setCustomRange: (r) => set({ customRange: r }),
  setSampling: (s) => set({ sampling: s }),
  setSegmentDays: (n) => set({ segmentDays: Math.max(1, Math.min(30, n)) }),
  reset: () => set({ ...DEFAULT_STATE })
}))
