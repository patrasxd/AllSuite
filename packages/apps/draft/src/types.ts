import type { ComponentType, ReactNode } from 'react'

export type Locale = 'en' | 'pl'

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
  category: 'documents'
  tags: Record<Locale, string[]>
  icon: ReactNode
}

export interface AppModule {
  AppComponent: ComponentType<AppComponentProps>
}
