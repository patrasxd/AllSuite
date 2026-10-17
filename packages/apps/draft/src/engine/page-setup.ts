import type { DraftDocument } from './document-model'
import { storiesFor, validateStories, type Stories } from './stories'
import type { DraftNode } from './document-model'

/** Physical dimensions in OOXML twips (1/1440 inch). Width/height are already oriented. */
export interface PageSetup {
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
  top: number
  right: number
  bottom: number
  left: number
  header: number
  footer: number
  headerText: string
  footerText: string
  pageNumbers: boolean
  stories?: Stories
}
export const mmToTwips = (mm: number) => Math.round((mm * 1440) / 25.4)
export const twipsToMM = (twips: number) => (twips * 25.4) / 1440
export const PAGE_PRESETS = {
  a4: [11906, 16838],
  letter: [12240, 15840],
  a5: [8391, 11906],
  legal: [12240, 20160],
} as const
export const DEFAULT_PAGE_SETUP: Readonly<PageSetup> = Object.freeze({
  width: PAGE_PRESETS.a4[0],
  height: PAGE_PRESETS.a4[1],
  orientation: 'portrait',
  top: mmToTwips(20),
  right: mmToTwips(20),
  bottom: mmToTwips(20),
  left: mmToTwips(20),
  header: mmToTwips(10),
  footer: mmToTwips(10),
  headerText: '',
  footerText: '',
  pageNumbers: false,
})

export function validatePageSetup(input: unknown): PageSetup | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  for (const key of ['width', 'height', 'top', 'right', 'bottom', 'left', 'header', 'footer']) {
    const n = value[key]
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > 31680) return null
  }
  if (value.orientation !== 'portrait' && value.orientation !== 'landscape') return null
  if (typeof value.pageNumbers !== 'boolean') return null
  for (const key of ['headerText', 'footerText']) {
    const text = value[key]
    if (
      typeof text !== 'string' ||
      text.length > 200 ||
      Array.from(text).some((character) => {
        const code = character.codePointAt(0)!
        return code < 32 || code === 127 || code === 0x2028 || code === 0x2029
      })
    )
      return null
  }
  const page = value as unknown as PageSetup
  // At least 25 mm of editable body in each direction; no negative body or inverted bands.
  if (page.width - page.left - page.right < 1440 || page.height - page.top - page.bottom < 1440) return null
  if (page.headerText && page.top - page.header < 360) return null
  if ((page.footerText || page.pageNumbers) && page.bottom - page.footer < 360) return null
  const result = Object.fromEntries(
    Object.keys(DEFAULT_PAGE_SETUP).map((key) => [key, value[key]]),
  ) as unknown as PageSetup
  if (value.stories !== undefined) {
    const stories = validateStories(value.stories)
    if (!stories) return null
    result.stories = stories
  }
  return result
}

export function readPageSetup(document: Pick<DraftDocument, 'attrs'>): PageSetup {
  try {
    const value = document.attrs?.pageSetup
    return validatePageSetup(typeof value === 'string' ? JSON.parse(value) : value) || { ...DEFAULT_PAGE_SETUP }
  } catch {
    return { ...DEFAULT_PAGE_SETUP }
  }
}
export function pagePreset(page: PageSetup): string {
  return (
    Object.entries(PAGE_PRESETS).find(
      ([, [w, h]]) =>
        Math.abs(Math.min(page.width, page.height) - w) <= 1 && Math.abs(Math.max(page.width, page.height) - h) <= 1,
    )?.[0] || 'custom'
  )
}
export function orientPage(page: PageSetup, orientation: PageSetup['orientation']): PageSetup {
  return page.orientation === orientation
    ? { ...page }
    : { ...page, width: page.height, height: page.width, orientation }
}
export function presetPage(page: PageSetup, preset: string): PageSetup {
  const dimensions = PAGE_PRESETS[preset as keyof typeof PAGE_PRESETS]
  if (!dimensions) return page
  const [w, h] = dimensions
  return { ...page, width: page.orientation === 'landscape' ? h : w, height: page.orientation === 'landscape' ? w : h }
}

// CSS strings are embedded in a style element, so '<' must be escaped as well as CSS delimiters.
const cssString = (value: string) => value.replace(/[\\"<>\r\n\f]/g, (c) => `\\${c.codePointAt(0)!.toString(16)} `)
export function pagePrintCSS(page: PageSetup): string {
  const pt = (value: number) => `${value / 20}pt`
  const footer = `"${cssString(page.footerText)}"${page.pageNumbers ? ' "  " counter(page) " / " counter(pages)' : ''}`
  const base = `@page{size:${pt(page.width)} ${pt(page.height)};margin:${pt(page.top)} ${pt(page.right)} ${pt(page.bottom)} ${pt(page.left)};font-family:Arimo,sans-serif;font-size:9pt;line-height:12pt;@top-center{content:"${cssString(page.headerText)}";vertical-align:top;padding-top:${pt(page.header)};white-space:nowrap;overflow:hidden}@bottom-center{content:${footer};vertical-align:bottom;padding-bottom:${pt(page.footer)};white-space:nowrap;overflow:hidden}}body{--image-height:${pt(page.height - page.top - page.bottom - 240)}}`
  if (!page.stories) return base
  const s = storiesFor(page)
  // Native paged media supports generated strings/counters/images, not rich running elements.
  // Retain text, line breaks and fields here; DOCX and editor previews retain run formatting.
  const content = (nodes: DraftNode[]): string =>
    nodes
      .flatMap((node, i) => {
        if (node.type === 'paragraph') return [...(i ? ['"\\a "'] : []), content(node.content || [])]
        if (node.type === 'storyField')
          return node.attrs?.field === 'PAGE'
            ? `counter(page, ${s.format === 'decimal' ? 'decimal' : s.format === 'lowerRoman' ? 'lower-roman' : 'upper-roman'})`
            : node.attrs?.field === 'NUMPAGES'
              ? 'counter(pages)'
              : `"${cssString(s.title)}"`
        if (node.type === 'hardBreak') return '"\\a "'
        if (node.type === 'image') {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Number(node.attrs?.width) || 100}" height="${Number(node.attrs?.height) || 50}"><image width="100%" height="100%" href="${String(
            node.attrs?.src || '',
          )
            .replaceAll('&', '&amp;')
            .replaceAll('"', '&quot;')
            .replaceAll('<', '&lt;')}"/></svg>`
          return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
        }
        return `"${cssString(node.text || '')}"`
      })
      .join(' ') || '""'
  const boxes = (variant: 'default' | 'first' | 'even') =>
    `@top-center{content:${content(s.header[variant])};white-space:pre-wrap}@bottom-center{content:${content(s.footer[variant])};white-space:pre-wrap}`
  return `${base}@page{counter-increment:page 1;${boxes('default')}}${s.differentEven ? `@page:left{${boxes('even')}}@page:right{${boxes('default')}}` : ''}@page:first{counter-increment:page ${s.start};${s.differentFirst ? boxes('first') : ''}}`
}
