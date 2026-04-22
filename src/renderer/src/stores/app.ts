/**
 * App-level ephemeral UI state — the current wizard step, the Tweaks
 * drawer visibility, and a pluggable "start download" handler that Step 3
 * registers once it mounts.
 *
 * This store is intentionally *not* persisted (unlike `settings.ts`). It
 * represents runtime navigation state, which should reset on reload.
 */
import { create } from 'zustand'

export type AppStep = 0 | 1 | 2 | 3

/**
 * DownloadStep registers its actual "start export" handler via
 * `setOnStartDownload` inside a `useEffect` so the FooterBar's "开始下载"
 * button can invoke it without the shell knowing anything about export
 * params. DownloadStep also publishes loading/disabled so the footer
 * button reflects real state instead of eagerly firing and failing via
 * toast — Step 3 used to have a duplicate button; the single source of
 * truth now lives in the footer.
 */
export type StartDownloadHandler = () => void

export interface StartDownloadState {
  loading: boolean
  disabled: boolean
}

interface AppState {
  step: AppStep
  tweaksOpen: boolean
  onStartDownload: StartDownloadHandler
  startDownloadState: StartDownloadState
  setStep: (n: AppStep) => void
  goNext: () => void
  goPrev: () => void
  setTweaksOpen: (v: boolean) => void
  setOnStartDownload: (fn: StartDownloadHandler) => void
  setStartDownloadState: (s: StartDownloadState) => void
}

const clampStep = (n: number): AppStep => {
  if (n <= 0) return 0
  if (n >= 3) return 3
  return n as AppStep
}

const defaultStartDownload: StartDownloadHandler = () => {
  /* no-op; DownloadStep overrides this on mount */
}

export const useAppStore = create<AppState>((set, get) => ({
  step: 0,
  tweaksOpen: false,
  onStartDownload: defaultStartDownload,
  startDownloadState: { loading: false, disabled: true },
  setStep: (n) => set({ step: clampStep(n) }),
  goNext: () => set({ step: clampStep(get().step + 1) }),
  goPrev: () => set({ step: clampStep(get().step - 1) }),
  setTweaksOpen: (v) => set({ tweaksOpen: v }),
  setOnStartDownload: (fn) => set({ onStartDownload: fn }),
  setStartDownloadState: (s) => set({ startDownloadState: s })
}))
