import DOMPurify, { type UponSanitizeAttributeHook } from 'dompurify'
import { normalizeHexColor, parseFontSize } from '../engine/formatting'
import { safeImageSource } from '../engine/images'
import { safeLink } from '../engine/references'

function clipboardColor(value: string): string | null {
  const normalized = normalizeHexColor(value)
  if (normalized) return normalized
  const probe = document.createElement('span')
  probe.style.color = value
  if (!probe.style.color) return null
  document.body.appendChild(probe)
  try {
    return normalizeHexColor(getComputedStyle(probe).color)
  } finally {
    probe.remove()
  }
}

export function sanitizeClipboardHTML(html: string): string {
  const withoutConditionalMarkup = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')
  const localImages: UponSanitizeAttributeHook = (element, data) => {
    if (element.tagName.toLowerCase() === 'img' && (data.attrName === 'src' || data.attrName === 'data-fallback-src')) {
      const safe = safeImageSource(data.attrValue)
      if (safe) data.attrValue = safe
      else data.keepAttr = false
    }
  }
  DOMPurify.addHook('uponSanitizeAttribute', localImages)
  let safe: string
  try {
    safe = DOMPurify.sanitize(withoutConditionalMarkup, {
      ALLOWED_TAGS: [
        'p',
        'div',
        'span',
        'br',
        'strong',
        'b',
        'em',
        'i',
        'u',
        's',
        'del',
        'sub',
        'sup',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'blockquote',
        'hr',
        'ul',
        'ol',
        'li',
        'mark',
        'a',
        'table',
        'thead',
        'tbody',
        'tfoot',
        'tr',
        'td',
        'th',
        'colgroup',
        'col',
        'img',
      ],
      ALLOWED_ATTR: [
        'style',
        'start',
        'href',
        'colspan',
        'rowspan',
        'width',
        'colwidth',
        'data-repeat-header',
        'data-page-break',
        'data-keepnext',
        'data-keeplines',
        'data-widowcontrol',
        'src',
        'alt',
        'height',
        'data-alignment',
        'data-wrap',
        'data-fallback-src',
      ],
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    })
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute', localImages)
  }
  // DOMPurify removes active/resource elements first; then retain formatting styles only.
  const root = document.createElement('div')
  root.innerHTML = safe
  for (const image of root.querySelectorAll('img')) {
    const src = safeImageSource(image.getAttribute('src') || '')
    if (!src || (image.getAttribute('width') === '1' && image.getAttribute('height') === '1')) image.remove()
    else {
      image.src = src
      const fallback = safeImageSource(image.getAttribute('data-fallback-src') || '')
      image.removeAttribute('data-fallback-src')
      if (fallback) image.setAttribute('data-fallback-src', fallback)
    }
  }
  for (const element of root.querySelectorAll<HTMLElement>('[style]')) {
    const input = element.style
    const styles: Record<string, string> = {}
    if (input.breakBefore === 'page' || input.pageBreakBefore === 'always') styles['break-before'] = 'page'
    for (const name of [
      'color',
      'background-color',
      'font-family',
      'font-weight',
      'font-style',
      'text-decoration',
      'text-align',
      'vertical-align',
      'padding',
      'border-top',
      'border-right',
      'border-bottom',
      'border-left',
      'width',
      'margin-left',
      'margin-right',
    ]) {
      const value = input.getPropertyValue(name)
      if (value && !/url\s*\(|var\s*\(|expression\s*\(/i.test(value)) {
        const normalized = name === 'color' || name === 'background-color' ? clipboardColor(value) : value
        if (normalized) styles[name] = normalized
      }
    }
    const pointSize = input.fontSize.endsWith('px')
      ? Number.parseFloat(input.fontSize) * 0.75
      : parseFontSize(input.fontSize)
    if (Number.isFinite(pointSize) && pointSize !== null && pointSize >= 6 && pointSize <= 144)
      styles['font-size'] = `${Math.round(pointSize * 100) / 100}pt`
    element.removeAttribute('style')
    for (const [name, value] of Object.entries(styles)) element.style.setProperty(name, value)
  }
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a')) {
    const href = safeLink(link.getAttribute('href'))
    if (!href) link.replaceWith(...Array.from(link.childNodes))
    else {
      link.setAttribute('href', href)
      if (!href.startsWith('#')) link.setAttribute('target', '_blank')
      link.setAttribute('rel', 'noopener noreferrer')
    }
  }
  for (const table of root.querySelectorAll<HTMLTableElement>('table')) {
    const pixels = (value: string) =>
      /%$/.test(value) ? NaN : Number.parseFloat(value) * (value.endsWith('pt') ? 4 / 3 : 1)
    const cols = Array.from(table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col'))
    const occupied: number[] = []
    Array.from(table.rows).forEach((row, rowIndex) => {
      let column = 0
      for (const cell of Array.from(row.cells)) {
        while ((occupied[column] || 0) > rowIndex) column++
        const span = Math.max(1, Math.min(100, cell.colSpan))
        cell.colSpan = span
        cell.rowSpan = Math.max(1, Math.min(100, cell.rowSpan))
        const existing = cell.getAttribute('colwidth')?.split(',').map(Number)
        const widths = Array.from({ length: span }, (_, i) => {
          const col = cols[column + i]
          return (
            existing?.[i] ||
            pixels(col?.style.width || col?.getAttribute('width') || '') ||
            pixels(cell.style.width || cell.getAttribute('width') || '') / span
          )
        })
        cell.removeAttribute('colwidth')
        if (widths.every((width) => Number.isFinite(width) && width > 0 && width <= 10000))
          cell.setAttribute('colwidth', widths.map(Math.round).join(','))
        for (let i = 0; i < span; i++) occupied[column + i] = rowIndex + cell.rowSpan
        column += span
      }
    })
  }
  return root.innerHTML
}
