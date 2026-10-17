import type { ComponentType, ReactNode } from 'react'
import type { Locale } from '@all/ui'

export type { Locale } from '@all/ui'

export interface AppComponentProps {
  locale: Locale
  isEink?: boolean
  setHeader?: (content: ReactNode) => void
  isDirty?: boolean
  setIsDirty?: (dirty: boolean) => void
}

export interface AppMetadata {
  slug: string
  name: Record<Locale, string>
  description: Record<Locale, string>
  category: string
  tags: Record<Locale, string[]>
  icon: ReactNode
}

export interface AppModule {
  AppComponent: ComponentType<AppComponentProps>
}
