import type { ReactNode } from 'react'
import type { Locale } from '../../../ui/src/app-host'

export type { AppComponentProps, AppModule, Locale } from '../../../ui/src/app-host'

export interface AppMetadata {
  slug: string
  name: Record<Locale, string>
  description: Record<Locale, string>
  category: 'documents'
  tags: Record<Locale, string[]>
  icon: ReactNode
}
