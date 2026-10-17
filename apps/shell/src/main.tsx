import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionProvider } from '@all/ui'
import { ThemeProvider, useTheme } from './hooks/useTheme'
import './theme-init'
import App from './App'
import './styles.css'

function ThemedApp() {
  const { isEink } = useTheme()
  return (
    <MotionProvider forcedNone={isEink}>
      <App />
    </MotionProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  </StrictMode>,
)
