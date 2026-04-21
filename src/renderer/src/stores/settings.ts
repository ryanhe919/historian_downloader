/**
 * Global UI preferences — theme / accent / density.
 *
 * Persisted to localStorage under the `hd.settings` key (single JSON blob)
 * per architecture §9.
 */
import { create } from 'zustand'

export type Theme = 'light' | 'dark'
export type Accent = 'blue' | 'purple' | 'green' | 'teal'
export type Density = 'compact' | 'comfortable'

export interface SettingsState {
  theme: Theme
  accent: Accent
  density: Density
  setTheme: (t: Theme) => void
  setAccent: (a: Accent) => void
  setDensity: (d: Density) => void
  toggleTheme: () => void
}

const STORAGE_KEY = 'hd.settings'

interface PersistedSettings {
  theme?: Theme
  accent?: Accent
  density?: Density
}

function detectInitialTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function loadPersisted(): PersistedSettings {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as PersistedSettings
    if (parsed && typeof parsed === 'object') return parsed
    return {}
  } catch {
    return {}
  }
}

function persist(state: PersistedSettings): void {
  if (typeof window === 'undefined') return
  try {
    const snapshot: PersistedSettings = {
      theme: state.theme,
      accent: state.accent,
      density: state.density
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* quota exceeded / private mode — silently ignore */
  }
}

const persisted = loadPersisted()
const initialTheme: Theme = persisted.theme ?? detectInitialTheme()
const initialAccent: Accent = persisted.accent ?? 'blue'
const initialDensity: Density = persisted.density ?? 'comfortable'

export const useSettings = create<SettingsState>((set, get) => ({
  theme: initialTheme,
  accent: initialAccent,
  density: initialDensity,
  setTheme: (t) => {
    set({ theme: t })
    persist(get())
  },
  setAccent: (a) => {
    set({ accent: a })
    persist(get())
  },
  setDensity: (d) => {
    set({ density: d })
    persist(get())
  },
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    set({ theme: next })
    persist(get())
  }
}))
