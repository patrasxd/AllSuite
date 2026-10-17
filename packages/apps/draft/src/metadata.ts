import { createElement } from 'react'
import type { AppMetadata } from './types'

// Static metadata only. Never import the runtime entry or document engines here.
export const metadata: AppMetadata = {
  slug: 'draft',
  name: { en: 'Draft', pl: 'Draft' },
  description: {
    en: 'Write and format documents privately, with a clear workspace that works offline.',
    pl: 'Pisz i formatuj dokumenty prywatnie, w przejrzystej przestrzeni działającej offline.',
  },
  category: 'documents',
  tags: { en: ['Documents'], pl: ['Dokumenty'] },
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
    createElement('path', { d: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6' }),
  ),
}
