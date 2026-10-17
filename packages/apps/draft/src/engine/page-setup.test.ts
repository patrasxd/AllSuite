import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAGE_SETUP,
  mmToTwips,
  orientPage,
  pagePreset,
  pagePrintCSS,
  presetPage,
  readPageSetup,
  twipsToMM,
  validatePageSetup,
} from './page-setup'
import { exportHTML } from './export/html'

describe('physical page setup', () => {
  it('preserves oriented dimensions without double rotation and identifies presets', () => {
    const letter = presetPage({ ...DEFAULT_PAGE_SETUP }, 'letter')
    const landscape = orientPage(letter, 'landscape')
    expect([landscape.width, landscape.height]).toEqual([15840, 12240])
    expect(orientPage(landscape, 'landscape')).toEqual(landscape)
    expect(pagePreset(landscape)).toBe('letter')
    expect(pagePreset({ ...letter, width: 13000 })).toBe('custom')
    expect(twipsToMM(mmToTwips(12.5))).toBeCloseTo(12.5, 1)
  })
  it('rejects nonfinite, excessive, fractional, negative or unusable geometry and header overlap', () => {
    for (const change of [
      { width: NaN },
      { height: 40000 },
      { top: -1 },
      { width: 1000 },
      { left: 10000 },
      { right: 2.3 },
      { headerText: '\n' },
      { footerText: 'x'.repeat(201) },
      { headerText: 'Header', top: 600, header: 600 },
      { pageNumbers: true, bottom: 0 },
    ])
      expect(validatePageSetup({ ...DEFAULT_PAGE_SETUP, ...change })).toBeNull()
    expect(validatePageSetup(DEFAULT_PAGE_SETUP)).toEqual(DEFAULT_PAGE_SETUP)
    expect(readPageSetup({ attrs: { pageSetup: '{bad' } })).toEqual(DEFAULT_PAGE_SETUP)
    expect(readPageSetup({ attrs: { pageSetup: 99 } })).toEqual(DEFAULT_PAGE_SETUP)
  })
  it('escapes CSS and HTML delimiters without injecting style markup, even in standalone exports', () => {
    const page = {
      ...DEFAULT_PAGE_SETUP,
      headerText: '</style><script>alert("x")</script>\\',
      footerText: 'Zażółć',
      pageNumbers: true,
    }
    const css = pagePrintCSS(page)
    expect(css).not.toContain('</style>')
    expect(css).toContain('counter(page)')
    expect(css).toContain('counter(pages)')
    const doc = {
      type: 'doc' as const,
      attrs: { pageSetup: JSON.stringify(page) },
      content: [{ type: 'paragraph', content: [{ type: 'pageBreak' }, { type: 'text', text: 'After' }] }],
    }
    const before = JSON.stringify(doc)
    const html = exportHTML(doc)
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    expect(parsed.querySelectorAll('script')).toHaveLength(0)
    expect(parsed.querySelectorAll('style')).toHaveLength(1)
    expect(parsed.querySelector('.page-break')).not.toBeNull()
    expect(JSON.stringify(doc)).toBe(before)
  })
})
