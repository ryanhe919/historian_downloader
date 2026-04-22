import '@/styles/fonts.css'
import '@/styles/tokens.css'
import '@/styles/globals.css'
import '@/styles/density.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, ThemeProvider, ToastProvider } from '@timeui/react'
import App from './App'
import { useSettings } from '@/hooks/useSettings'

/**
 * Wires the zustand settings store to TimeUI's ThemeProvider so that
 * every TimeUI component (Button, Card, Switch, …) re-themes when the
 * user toggles light/dark from the Tweaks drawer or the titlebar.
 *
 * Our own CSS variables live on `<html data-theme>` and are controlled
 * separately by `useSettingsSideEffects` inside App.
 */
export function Themed({ children }: { children: React.ReactNode }): React.JSX.Element {
  const theme = useSettings((s) => s.theme)
  return (
    <ConfigProvider>
      <ThemeProvider mode={theme}>
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </ConfigProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Themed>
      <App />
    </Themed>
  </StrictMode>
)
