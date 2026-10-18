import { createElement } from 'react'
import type { AppMetadata } from './types'

// Catalog metadata is intentionally independent from Grid's lazy runtime.
export const metadata: AppMetadata = {
  slug: 'grid',
  name: { en: 'Grid', pl: 'Grid' },
  description: {
    en: 'A private spreadsheet workspace. In development.',
    pl: 'Prywatna przestrzeń arkusza kalkulacyjnego. W przygotowaniu.',
  },
  category: 'spreadsheets',
  tags: { en: ['Spreadsheets'], pl: ['Arkusze kalkulacyjne'] },
  icon: createElement(
    'svg',
    {
      width: 28,
      height: 28,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    createElement('rect', { x: 3, y: 4, width: 18, height: 16, rx: 1 }),
    createElement('path', { d: 'M3 9h18M9 9v11m6-11v11M3 14h18' }),
  ),
}
