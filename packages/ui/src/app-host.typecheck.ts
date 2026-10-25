import type { ComponentType, ReactNode } from 'react'
import type { Locale as UiLocale } from '@all/ui'
import type * as Host from './app-host'
import type * as Shell from '../../../apps/shell/src/types/app'
import type * as Draft from '../../apps/draft/src/types'
import type * as Grid from '../../apps/grid/src/types'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

// This file is checked with tsc, including required/optional keys and
// exact callback arguments. No runtime code or app implementation is imported.
interface ExpectedProps {
  locale: 'en' | 'pl'
  isEink?: boolean
  setHeader?: (content: ReactNode) => void
  isDirty?: boolean
  setIsDirty?: (dirty: boolean) => void
}

export type HostContractAssertions = [
  Expect<Equal<Host.AppComponentProps, ExpectedProps>>,
  Expect<Equal<Host.Locale, UiLocale>>,
  Expect<Equal<Host.Locale, 'en' | 'pl'>>,
  Expect<Equal<Shell.AppComponentProps, Host.AppComponentProps>>,
  Expect<Equal<Draft.AppComponentProps, Host.AppComponentProps>>,
  Expect<Equal<Grid.AppComponentProps, Host.AppComponentProps>>,
  Expect<Equal<Shell.Locale, Host.Locale>>,
  Expect<Equal<Draft.Locale, Host.Locale>>,
  Expect<Equal<Grid.Locale, Host.Locale>>,
  Expect<Equal<Host.AppModule, { AppComponent: ComponentType<ExpectedProps> }>>,
  Expect<Equal<Shell.AppModule, Host.AppModule>>,
  Expect<Equal<Draft.AppModule, Host.AppModule>>,
  Expect<Equal<Grid.AppModule, Host.AppModule>>,
  Expect<Equal<Draft.AppMetadata['category'], 'documents'>>,
  Expect<Equal<Grid.AppMetadata['category'], 'spreadsheets'>>,
  Expect<Equal<Shell.AppMetadata['category'], string>>,
]
