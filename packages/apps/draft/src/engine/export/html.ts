import type { DraftDocument, DraftNode } from '../document-model'
import { safeImageSource } from '../images'
import { normalizeHexColor } from '../formatting'
import { safeLink, validTargetId } from '../references'
import { paragraphStyleId, type StyleFormat } from '../styles'
import { pagePrintCSS, presetPage, orientPage, readPageSetup } from '../page-setup'
import {
  bounded,
  escapeHTML as esc,
  exportContext,
  exportFontFamily,
  type ExportFont,
  type ExportOptions,
} from './model'

export const exportCSS = `*{box-sizing:border-box}html{background:#fff;color:#202020}body{margin:0;font-family:Arimo,sans-serif;font-size:12pt;line-height:1.5}main{max-width:100%;overflow-wrap:anywhere}p{margin:0 0 8pt;white-space:pre-wrap}h1,h2,h3,h4,h5,h6{break-after:avoid;page-break-after:avoid}p,li{orphans:3;widows:3}a{color:inherit;text-decoration:underline}img{max-width:100%;height:auto;max-height:var(--image-height);object-fit:contain;vertical-align:middle;break-inside:avoid}table{border-collapse:collapse;table-layout:fixed;max-width:100%;margin-block:8pt}td,th{overflow-wrap:anywhere;min-width:0}th{font-weight:700;text-align:left}td p:last-child,th p:last-child{margin-bottom:0}tr{break-inside:avoid;page-break-inside:avoid}thead{display:table-header-group}tbody{break-inside:auto}ul,ol{padding-left:24pt}li>p{margin-block:0}li>ul,li>ol{margin-block:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:Cousine,monospace}blockquote{margin:8pt 18pt}hr{border:0;border-top:1px solid #808080;clear:both}nav{margin-block:12pt}nav p{margin-block:0}section.note{border-top:1px solid #808080;margin-top:18pt;padding-top:6pt;break-inside:avoid}section.note p{margin-left:24pt}section.note>a{float:left}sup,sub{line-height:0}mark{color:inherit}@media screen{body{padding:20mm;max-width:250mm;margin:auto}}@media print{html,body{margin:0;padding:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}main{width:100%}a{color:inherit}img{float:none!important}pre,blockquote{break-inside:auto}}`

function formatCSS(format: StyleFormat) {
  return [
    `font-family:${exportFontFamily(format.fontFamily)}`,
    format.fontSize !== undefined && `font-size:${format.fontSize}pt`,
    format.color && `color:${format.color}`,
    format.bold !== undefined && `font-weight:${format.bold ? 700 : 400}`,
    format.italic !== undefined && `font-style:${format.italic ? 'italic' : 'normal'}`,
    format.textAlign && `text-align:${format.textAlign}`,
    format.keepNext !== undefined && `break-after:${format.keepNext ? 'avoid-page' : 'auto'}`,
    format.keepLines !== undefined && `break-inside:${format.keepLines ? 'avoid-page' : 'auto'}`,
    format.widowControl !== undefined && `widows:${format.widowControl ? 2 : 1};orphans:${format.widowControl ? 2 : 1}`,
    format.spacingBefore !== undefined && `margin-top:${format.spacingBefore}pt`,
    format.spacingAfter !== undefined && `margin-bottom:${format.spacingAfter}pt`,
    format.lineSpacing !== undefined && `line-height:${format.lineSpacing}`,
    format.indentLeft !== undefined && `margin-left:${format.indentLeft}pt`,
    format.indentRight !== undefined && `margin-right:${format.indentRight}pt`,
    (format.indentFirstLine !== undefined || format.indentHanging !== undefined) &&
      `text-indent:${(format.indentFirstLine || 0) - (format.indentHanging || 0)}pt`,
  ]
    .filter(Boolean)
    .join(';')
}
function fontCSS(fonts: ExportFont[]) {
  return fonts
    .map((font) => {
      if (
        !/^(Arimo|Carlito|Caladea|Tinos|Cousine)$/.test(font.family) ||
        !/^data:font\/woff2;base64,[A-Za-z0-9+/]+=*$/.test(font.source)
      )
        throw new Error('Invalid embedded font')
      const range =
        font.subset === 'latin-ext'
          ? 'U+0100-024F,U+0300-036F,U+1E00-1EFF'
          : 'U+0000-00FF,U+2000-206F,U+20AC,U+2113,U+FEFF,U+FFFD'
      return `@font-face{font-family:${font.family};font-weight:${font.weight === 700 ? 700 : 400};font-style:${font.style === 'italic' ? 'italic' : 'normal'};src:url(${font.source}) format('woff2');unicode-range:${range}}`
    })
    .join('\n')
}
export function renderHTMLBody(input: DraftDocument) {
  const context = exportContext(input)
  function render(node: DraftNode, base: StyleFormat = {}): string {
    const attrs = node.attrs || {}
    const contents = (format = base) => (node.content || []).map((child) => render(child, format)).join('')
    if (node.type === 'text') {
      const format = context.run(node, base)
      if (node.marks?.some((mark) => mark.type === 'code')) format.fontFamily = 'Cousine'
      let html = esc(node.text)
      if (node.marks?.length)
        html = `<span style="${formatCSS({ fontFamily: format.fontFamily, fontSize: format.fontSize, color: format.color, bold: format.bold, italic: format.italic })}">${html}</span>`
      for (const mark of node.marks || []) {
        if (mark.type === 'code') html = `<code>${html}</code>`
        if (mark.type === 'underline') html = `<u>${html}</u>`
        if (mark.type === 'strike') html = `<s>${html}</s>`
        if (mark.type === 'subscript') html = `<sub>${html}</sub>`
        if (mark.type === 'superscript') html = `<sup>${html}</sup>`
        if (mark.type === 'highlight') {
          const color = normalizeHexColor(String(mark.attrs?.color || ''))
          if (color) html = `<mark style="background-color:${color}">${html}</mark>`
        }
        if (mark.type === 'link') {
          const href = safeLink(mark.attrs?.href)
          if (href)
            html = `<a href="${esc(href)}"${href.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${html}</a>`
        }
      }
      return html
    }
    if (node.type === 'hardBreak') return '<br>'
    if (node.type === 'captionNumber')
      return esc(`${attrs.showLabel === false ? '' : String(attrs.label || 'Figure') + ' '}${attrs.number || 1}`)
    if (node.type === 'pageBreak') return '<span class="page-break" data-page-break="" aria-hidden="true"></span>'
    if (node.type === 'image') {
      const source = safeImageSource(String(attrs.src || ''))
      if (!source) return esc(attrs.alt || '[Image]')
      const alignment = ['left', 'center', 'right'].includes(String(attrs.alignment))
        ? String(attrs.alignment)
        : 'inline'
      const layout =
        attrs.wrap === 'square-left'
          ? 'float:left;margin:0 12pt 8pt 0'
          : attrs.wrap === 'square-right'
            ? 'float:right;margin:0 0 8pt 12pt'
            : alignment === 'center'
              ? 'display:block;margin-inline:auto'
              : alignment === 'right'
                ? 'display:block;margin-left:auto'
                : alignment === 'left'
                  ? 'display:block'
                  : ''
      const width = bounded(attrs.width, 300, 1, 16384)
      const height = bounded(attrs.height, 150, 1, 16384)
      return `<img src="${esc(source)}" alt="${esc(attrs.alt)}" width="${width}" height="${height}" style="width:min(100%,${width}px,calc(var(--image-height) * ${width / height}));aspect-ratio:${width}/${height};object-fit:fill;${layout}${attrs.wrap === 'top-bottom' ? ';display:block;clear:both' : ''}">`
    }
    if (node.type === 'paragraph' || node.type === 'heading') {
      const format = context.format(node)
      if (base.bold && paragraphStyleId(node) === 'Normal') format.bold = true
      const level = context.level(node)
      const code = paragraphStyleId(node) === 'Code'
      const tag = level ? `h${level}` : code ? 'pre' : 'p'
      const id = validTargetId(attrs.anchorId) ? ` id="${esc(attrs.anchorId)}"` : ''
      // A break inside an inline formatting context is ignored by browser print layout.
      // Split only the disposable projection into block siblings; keep the editor model intact.
      const parts: DraftNode[][] = [[]]
      for (const child of node.content || []) {
        if (child.type === 'pageBreak') parts.push([])
        else parts[parts.length - 1].push(child)
      }
      return parts
        .map(
          (part, index) =>
            `${attrs.pageBreakBefore || index ? '<div class="page-break" aria-hidden="true"></div>' : ''}<${tag}${index === 0 ? id : ''} style="${formatCSS(format)}">${code ? '<code>' : ''}${part.map((child) => render(child, format)).join('') || '<br>'}${code ? '</code>' : ''}</${tag}>`,
        )
        .join('')
    }
    if (node.type === 'bookmark')
      return `<span${validTargetId(attrs.id) ? ` id="${esc(attrs.id)}"` : ''}>${contents()}</span>`
    if (node.type === 'crossReference')
      return validTargetId(attrs.targetId)
        ? `<a href="#${esc(attrs.targetId)}">${esc(attrs.label)}</a>`
        : esc(attrs.label)
    if (node.type === 'noteReference')
      return `<sup id="ref:${esc(attrs.id)}"><a href="#note:${esc(attrs.id)}">${attrs.kind === 'endnote' ? 'E' : ''}${bounded(attrs.number, 1, 1, 999999)}</a></sup>`
    if (node.type === 'note')
      return `<section class="note" id="note:${esc(attrs.id)}" aria-label="${attrs.kind === 'endnote' ? 'Endnote' : 'Footnote'} ${attrs.number}"><a href="#ref:${esc(attrs.id)}">${attrs.kind === 'endnote' ? 'E' : ''}${attrs.number}</a>${contents()}</section>`
    if (node.type === 'tableOfContents') return `<nav aria-label="Table of contents">${contents()}</nav>`
    if (node.type === 'tocEntry')
      return `<p class="draft-toc-entry" style="margin-left:${(bounded(attrs.level, 1, 1, 6) - 1) * 12}pt"><a${validTargetId(attrs.targetId) ? ` href="#${esc(attrs.targetId)}"` : ''}><span class="draft-toc-label">${contents()}</span><span class="draft-toc-leader" aria-hidden="true"></span><span class="draft-toc-page">${esc(attrs.pageNumber || '?')}</span></a></p>`
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const tag = node.type === 'bulletList' ? 'ul' : 'ol'
      return `<${tag}${tag === 'ol' ? ` start="${Math.round(bounded(attrs.start, 1, 1, 999999))}"` : ''}>${contents()}</${tag}>`
    }
    if (node.type === 'listItem') return `<li>${contents()}</li>`
    if (node.type === 'blockquote') return `<blockquote>${contents()}</blockquote>`
    if (node.type === 'codeBlock') return `<pre><code>${contents({ ...base, fontFamily: 'Cousine' })}</code></pre>`
    if (node.type === 'horizontalRule') return '<hr>'
    if (node.type === 'table') {
      const widths: number[] = []
      const explicitWidths = node.content?.some((row) =>
        row.content?.some((cell) => Array.isArray(cell.attrs?.colwidth)),
      )
      for (const row of node.content || []) {
        let column = 0
        for (const cell of row.content || []) {
          const span = Math.round(bounded(cell.attrs?.colspan, 1, 1, 100))
          for (let x = 0; x < span; x++)
            widths[column + x] ||= Array.isArray(cell.attrs?.colwidth)
              ? bounded(cell.attrs.colwidth[x], 96, 1, 10000)
              : 96
          column += span
        }
      }
      const total = widths.reduce((a, b) => a + b, 0) || 1
      const align = String(attrs.style || '')
      const margin = align.includes('margin-left: auto')
        ? align.includes('margin-right: auto')
          ? 'margin-inline:auto'
          : 'margin-left:auto'
        : ''
      let headerCount = 0
      while (node.content?.[headerCount]?.attrs?.repeatHeader) headerCount++
      const rows = node.content || []
      return `<table style="width:${explicitWidths ? `${total}px` : '100%'};${margin}"><colgroup>${widths.map((width) => `<col style="width:${Math.round((width / total) * 10000) / 100}%">`).join('')}</colgroup>${
        headerCount
          ? `<thead>${rows
              .slice(0, headerCount)
              .map((row) => render(row, base))
              .join('')}</thead>`
          : ''
      }<tbody>${rows
        .slice(headerCount)
        .map((row) => render(row, base))
        .join('')}</tbody></table>`
    }
    if (node.type === 'tableRow') return `<tr>${contents()}</tr>`
    if (node.type === 'tableCell' || node.type === 'tableHeader') {
      const tag = node.type === 'tableHeader' ? 'th' : 'td'
      const border = (value: unknown) => {
        const match = /^(\d+(?:\.\d+)?)px\s+(solid|none)(?:\s+(#[\da-f]{6}))?$/i.exec(String(value || ''))
        return match
          ? `${Math.min(12, Number(match[1]))}px ${match[2].toLowerCase()} ${match[3] || '#808080'}`
          : '1px solid #808080'
      }
      const background = normalizeHexColor(String(attrs.backgroundColor || ''))
      const vertical = ['top', 'middle', 'bottom'].includes(String(attrs.verticalAlign)) ? attrs.verticalAlign : 'top'
      const padding = Math.min(96, Math.max(0, Number.parseFloat(String(attrs.padding ?? '6')) || 0))
      const css = `padding:${padding}px;vertical-align:${vertical};${background ? `background-color:${background};` : ''}${['Top', 'Right', 'Bottom', 'Left'].map((side) => `border-${side.toLowerCase()}:${border(attrs['border' + side])}`).join(';')}`
      return `<${tag} colspan="${Math.round(bounded(attrs.colspan, 1, 1, 100))}" rowspan="${Math.round(bounded(attrs.rowspan, 1, 1, 100))}" style="${css}">${contents(tag === 'th' ? { ...base, bold: true } : base)}</${tag}>`
    }
    return contents()
  }
  return render(context.document)
}
export function exportHTML(input: DraftDocument, options: ExportOptions = {}): string {
  let page = readPageSetup(input)
  // Compatibility for callers of the previous session-only export API.
  if (options.pageSize) page = presetPage(page, options.pageSize)
  if (options.orientation === 'portrait' || options.orientation === 'landscape')
    page = orientPage(page, options.orientation)
  const columns = Math.round(bounded(input.attrs?.columns, 1, 1, 3))
  const css = `${fontCSS(options.fonts || [])}\n${exportCSS}\n${pagePrintCSS(page)}.draft-toc-entry>a{display:flex;align-items:baseline;gap:.4em;text-decoration:none}.draft-toc-label{min-width:0;overflow-wrap:anywhere}.draft-toc-leader{flex:1;min-width:1em;border-bottom:1px dotted currentColor}.draft-toc-page{flex:none;margin-left:auto;white-space:nowrap;font-variant-numeric:tabular-nums}.page-break{display:block;column-span:all;height:0;break-before:page;page-break-before:always}main{column-count:${columns > 1 ? columns : 'auto'};column-gap:20pt}`
  const language = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(options.language || '') ? options.language : 'en'
  const license = options.fontLicense
    ? `\n<!-- ${options.fontLicense.replaceAll('--', '—').replaceAll('<', '&lt;').replaceAll('>', '&gt;')} -->`
    : ''
  return `<!doctype html>\n<html lang="${language}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';img-src data:;font-src data:;script-src 'none';connect-src 'none';object-src 'none';base-uri 'none';form-action 'none'">\n<title>${esc(options.title || 'Untitled')}</title>\n<style>${css}</style>\n</head>\n<body><main>${renderHTMLBody(input)}</main></body>\n</html>${license}\n`
}
