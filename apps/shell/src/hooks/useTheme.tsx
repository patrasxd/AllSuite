import type { ReactNode } from 'react'
import { ThemeProvider as UiThemeProvider, useTheme as useUiTheme, type Theme as UiTheme } from '@all/ui'

export type Theme = UiTheme

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <UiThemeProvider defaultTheme="dark" storageKey="allsuite:theme">
      {children}
    </UiThemeProvider>
  )
}

export function useTheme() {
  return useUiTheme()
}
