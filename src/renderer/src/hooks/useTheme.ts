/**
 * useTheme — thin wrapper over the settings store that also drives the
 * `data-theme` attribute on <html>, which TimeUI uses for its dark-mode
 * tokens.
 */
import { useEffect } from 'react'
import { useSettings, type Theme } from '@/stores/settings'

export interface UseThemeResult {
  theme: Theme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

export function useTheme(): UseThemeResult {
  const theme = useSettings((s) => s.theme)
  const setTheme = useSettings((s) => s.setTheme)
  const toggleTheme = useSettings((s) => s.toggleTheme)

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return { theme, setTheme, toggleTheme }
}
