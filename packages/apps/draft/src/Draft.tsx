import { lazy, Suspense, useContext } from 'react'
import { ThemeContext } from '@all/ui'
import type { AppComponentProps } from './types'
import './draft.css'

const DocumentWorkspace = lazy(() => import('./components/DocumentWorkspace'))

export function Draft(props: AppComponentProps) {
  const theme = useContext(ThemeContext)
  const isEink = props.isEink ?? false
  return (
    <div
      className="draft-app"
      data-eink={isEink || undefined}
      data-theme={isEink ? (theme?.isDark ? 'e-ink-dark' : 'e-ink-light') : undefined}
    >
      <Suspense fallback={null}>
        <DocumentWorkspace {...props} />
      </Suspense>
    </div>
  )
}
