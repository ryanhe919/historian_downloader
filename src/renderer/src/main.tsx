import '@/styles/tokens.css'
import '@/styles/globals.css'
import '@/styles/density.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, ThemeProvider, ToastProvider } from '@timeui/react'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider>
      <ThemeProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </ThemeProvider>
    </ConfigProvider>
  </StrictMode>
)
