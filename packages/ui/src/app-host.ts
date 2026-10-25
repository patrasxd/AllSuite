import type { ComponentType, ReactNode } from 'react'
import type { Locale } from '@all/ui'

export type { Locale } from '@all/ui'

/** Shell-owned preferences and integration hooks shared by AllSuite apps. */
export interface AppComponentProps {
  locale: Locale
  isEink?: boolean
  setHeader?: (content: ReactNode) => void
  isDirty?: boolean
  setIsDirty?: (dirty: boolean) => void
}

/** Runtime entry shape loaded by the shell's lazy app registry. */
export interface AppModule {
  AppComponent: ComponentType<AppComponentProps>
}
