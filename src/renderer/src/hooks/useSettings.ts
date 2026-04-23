/**
 * useSettings — re-exports the zustand settings store and mirrors the
 * non-theme preferences onto the document element so that CSS can react
 * to them.
 *
 * - `theme` → `<html data-theme="...">`
 * - `accent` → `--c-primary` (rgb triple)
 * - `density` → `<html data-density="...">`
 *
 * Centralising all document-side effects here avoids the previous split
 * brain where TimeUI switched via ThemeProvider but our own CSS variables
 * never received the `data-theme` attribute.
 */
import { useEffect } from 'react'
import {
  useSettings as useSettingsStore,
  type Accent,
  type Density,
  type Theme
} from '@/stores/settings'

export type { Accent, Density, Theme, SettingsState } from '@/stores/settings'
export { useSettingsStore as useSettings }

const ACCENT_RGB: Record<Accent, string> = {
  blue: '0, 111, 238',
  purple: '120, 40, 200',
  green: '23, 140, 80',
  teal: '8, 151, 156'
}

/**
 * Mount once near the root (e.g. inside App.tsx) to wire `accent` and
 * `density` preferences to CSS.
 */
export function useSettingsSideEffects(): void {
  const theme = useSettingsStore((s) => s.theme)
  const accent = useSettingsStore((s) => s.accent)
  const density = useSettingsStore((s) => s.density)

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.style.colorScheme = theme
  }, [theme])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const rgb = ACCENT_RGB[accent]
    document.documentElement.style.setProperty('--c-primary', `rgb(${rgb})`)
    document.documentElement.style.setProperty('--c-focus', `rgb(${rgb})`)
  }, [accent])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-density', density)
  }, [density])
}

export function accentToRgb(accent: Accent): string {
  return ACCENT_RGB[accent]
}

// Convenience selector helpers
export const useAccent = (): Accent => useSettingsStore((s) => s.accent)
export const useDensity = (): Density => useSettingsStore((s) => s.density)
export const useTheme = (): Theme => useSettingsStore((s) => s.theme)
