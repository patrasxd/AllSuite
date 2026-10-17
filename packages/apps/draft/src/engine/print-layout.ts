import { escapeHTML as esc, type ExportFont } from './export/model'
import { safeLink } from './references'

export type Box = { x: number; y: number; width: number; height: number }
export type PrintItem = Box & { clip?: Box } & (
    | {
        kind: 'text'
        text: string
        baseline: number
        family: string
        size: number
        bold: boolean
        italic: boolean
        color: string
        underline?: boolean
        strike?: boolean
      }
    | { kind: 'rect'; color: string; dash?: 'dotted' | 'dashed' }
    | { kind: 'image'; source: string }
  )
export type PrintDestination = { page: number; x: number; y: number }
export type PrintLayout = {
  width: number
  height: number
  title: string
  language: string
  pages: Array<{ items: PrintItem[]; links: Array<Box & { href: string }> }>
  destinations: Record<string, PrintDestination>
  headings: Array<PrintDestination & { title: string; level: number }>
}
export function pageSVG(layout: PrintLayout, index: number): string {
  const page = layout.pages[index]
  const elements = page.items
    .map((item, n) => {
      let inner: string
      if (item.kind === 'rect')
        inner = item.dash
          ? `<line x1="${item.x}" y1="${item.y}" x2="${item.x + (item.width > item.height ? item.width : 0)}" y2="${item.y + (item.height >= item.width ? item.height : 0)}" stroke="${esc(item.color)}" stroke-width="${Math.min(item.width, item.height)}" stroke-dasharray="${item.dash === 'dotted' ? '1 2' : '4 3'}"/>`
          : `<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" fill="${esc(item.color)}"/>`
      else if (item.kind === 'image')
        inner = `<image x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" href="${esc(item.source)}" preserveAspectRatio="none"/>`
      else
        inner = `<text xml:space="preserve" x="${item.x}" y="${item.baseline}" font-family="${esc(item.family)}" font-size="${item.size}" font-weight="${item.bold ? 700 : 400}" font-style="${item.italic ? 'italic' : 'normal'}" fill="${esc(item.color)}" textLength="${item.width}" lengthAdjust="spacingAndGlyphs" text-decoration="${[item.underline && 'underline', item.strike && 'line-through'].filter(Boolean).join(' ')}">${esc(item.text)}</text>`
      return item.clip
        ? `<clipPath id="clip-${index}-${n}"><rect x="${item.clip.x}" y="${item.clip.y}" width="${item.clip.width}" height="${item.clip.height}"/></clipPath><g clip-path="url(#clip-${index}-${n})">${inner}</g>`
        : inner
    })
    .join('')
  const links = page.links
    .filter((link) => safeLink(link.href))
    .map(
      (link) =>
        `<a href="${esc(link.href.startsWith('#') && layout.destinations[link.href.slice(1)] ? '#print-page-' + layout.destinations[link.href.slice(1)].page : link.href)}"><rect x="${link.x}" y="${link.y}" width="${link.width}" height="${link.height}" fill="transparent"/></a>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="${esc(layout.title)} — ${index + 1}"><rect width="100%" height="100%" fill="white"/>${elements}${links}</svg>`
}
export function printStyles(layout: PrintLayout): string {
  return `@page{size:${layout.width * 0.75}pt ${layout.height * 0.75}pt;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:white;color:black}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.print-sheet{position:relative;width:${layout.width}px;height:${layout.height}px;overflow:hidden;break-after:page;page-break-after:always}.print-sheet:last-child{break-after:auto;page-break-after:auto}.print-sheet svg{display:block;width:100%;height:100%}@media screen{body{background:#ddd}.print-sheet{margin:24px auto}}@media print{html,body{width:${layout.width}px}.print-sheet{margin:0}}`
}
export function printLayoutHTML(layout: PrintLayout, fonts: ExportFont[], license = ''): string {
  const faces = fonts
    .map(
      (font) =>
        `@font-face{font-family:${font.family};font-weight:${font.weight};font-style:${font.style};src:url(${font.source}) format('woff2');unicode-range:${font.subset === 'latin' ? 'U+0000-00FF,U+2000-206F,U+20AC,U+2113,U+FEFF,U+FFFD' : 'U+0100-024F,U+0300-036F,U+1E00-1EFF'}}`,
    )
    .join('')
  return `<!doctype html><html lang="${esc(layout.language)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';font-src data:;img-src data:"><title>${esc(layout.title)}</title><style>${faces}${printStyles(layout)}</style></head><body>${layout.pages.map((_, i) => `<section class="print-sheet" id="print-page-${i}">${pageSVG(layout, i)}</section>`).join('')}<!--${license.replace(/--/g, '—')}--></body></html>`
}
