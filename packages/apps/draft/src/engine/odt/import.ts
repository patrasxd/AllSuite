import { strFromU8, unzipSync } from 'fflate'
import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom'
import type { DraftDocument, DraftMark, DraftNode, ImportResult, UnsupportedContent } from '../document-model'
import { bytesToDataURL, imageMime, safeImageSource } from '../images'
import { normalizeHexColor } from '../formatting'
import { normalizeReferences, safeLink } from '../references'
import { DEFAULT_PAGE_SETUP, validatePageSetup, type PageSetup } from '../page-setup'
import { readStyles, type DocumentStyle, type StyleFormat } from '../styles'

const office = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
const style = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0'
const text = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const table = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'
const draw = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0'
const svg = 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0'
const fo = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0'
const xlink = 'http://www.w3.org/1999/xlink'
type OdtStyle = {
  id: string
  kind: 'paragraph' | 'character'
  parent?: string
  format: StyleFormat
  marks: DraftMark[]
}

const localName = (node: XmlNode | XmlElement) => node.localName || node.nodeName.split(':').pop() || node.nodeName
const children = (node: XmlNode) => Array.from(node.childNodes).filter((child) => child.nodeType === 1) as XmlElement[]
function attr(element: XmlElement | undefined, namespace: string, name: string) {
  if (!element) return ''
  return (
    element.getAttributeNS(namespace, name) ||
    element.getAttribute(name) ||
    element.getAttribute(
      `${namespace === fo ? 'fo' : namespace === style ? 'style' : namespace === text ? 'text' : namespace === table ? 'table' : namespace === draw ? 'draw' : namespace === xlink ? 'xlink' : namespace === office ? 'office' : 'dc'}:${name}`,
    ) ||
    ''
  )
}
function direct(element: XmlElement | undefined, name: string) {
  return element ? children(element).find((child) => localName(child) === name) : undefined
}
function descendants(element: XmlElement | undefined, name: string) {
  if (!element) return []
  const result: XmlElement[] = []
  const visit = (node: XmlNode) => {
    for (const child of children(node)) {
      if (localName(child) === name) result.push(child)
      visit(child)
    }
  }
  visit(element)
  return result
}
function parseXML(source: string): XmlDocument {
  return new DOMParser({
    onError: (level, message) => {
      if (level === 'error' || level === 'fatalError') throw new Error(message)
    },
  }).parseFromString(source, 'application/xml')
}
function styleId(name: string) {
  let result = name.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z_]+/, '')
  if (!result) result = 'OdtStyle'
  return result.slice(0, 160)
}
function points(value: string): number | undefined {
  const match = /^(-?\d+(?:\.\d+)?)(pt|pc|in|cm|mm|px)?$/i.exec(value.trim())
  if (!match) return undefined
  const number = Number(match[1])
  const unit = (match[2] || 'pt').toLowerCase()
  const result = number * ({ pt: 1, pc: 12, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75 }[unit] || 1)
  return Number.isFinite(result) ? result : undefined
}
function styleFormat(element: XmlElement, family: string): StyleFormat {
  const p = direct(element, 'paragraph-properties')
  const r = direct(element, 'text-properties')
  const result: StyleFormat = {}
  const put = (key: keyof StyleFormat, source: XmlElement | undefined, namespace: string, name: string) => {
    const value = points(attr(source, namespace, name))
    if (value !== undefined) Object.assign(result, { [key]: value })
  }
  put('spacingBefore', p, fo, 'margin-top')
  put('spacingAfter', p, fo, 'margin-bottom')
  put('indentLeft', p, fo, 'margin-left')
  put('indentRight', p, fo, 'margin-right')
  put('fontSize', r, fo, 'font-size')
  if (p && ['left', 'center', 'right', 'justify'].includes(attr(p, fo, 'text-align')))
    result.textAlign = attr(p, fo, 'text-align') as StyleFormat['textAlign']
  if (p) {
    const line = attr(p, fo, 'line-height')
    const value = line.endsWith('%') ? Number.parseFloat(line) / 100 : points(line)
    if (value && value > 0 && value <= 10) result.lineSpacing = value
    const indent = points(attr(p, fo, 'text-indent'))
    if (indent !== undefined && indent >= 0) result.indentFirstLine = indent
    if (indent !== undefined && indent < 0) result.indentHanging = Math.abs(indent)
  }
  const color = normalizeHexColor(attr(r, fo, 'color'))
  if (color) result.color = color
  if (r) {
    const weight = attr(r, fo, 'font-weight').toLowerCase()
    const italic = attr(r, fo, 'font-style').toLowerCase()
    if (weight) result.bold = weight === 'bold' || Number(weight) >= 600
    if (italic) result.italic = italic === 'italic' || italic === 'oblique'
    const font = attr(r, style, 'font-name')
    if (font) result.fontFamily = font.slice(0, 160)
  }
  if (family === 'paragraph') return result
  return result
}
function marksFromStyle(element: XmlElement): DraftMark[] {
  const properties = direct(element, 'text-properties')
  if (!properties) return []
  const marks: DraftMark[] = []
  if (attr(properties, fo, 'font-weight').toLowerCase() === 'bold') marks.push({ type: 'bold' })
  if (['italic', 'oblique'].includes(attr(properties, fo, 'font-style').toLowerCase())) marks.push({ type: 'italic' })
  if (attr(properties, style, 'text-underline-style') && attr(properties, style, 'text-underline-style') !== 'none')
    marks.push({ type: 'underline' })
  if (
    attr(properties, style, 'text-line-through-style') &&
    attr(properties, style, 'text-line-through-style') !== 'none'
  )
    marks.push({ type: 'strike' })
  const position = attr(properties, style, 'text-position').toLowerCase()
  if (position.startsWith('sub')) marks.push({ type: 'subscript' })
  if (position.startsWith('super')) marks.push({ type: 'superscript' })
  const color = normalizeHexColor(attr(properties, fo, 'background-color'))
  if (color) marks.push({ type: 'highlight', attrs: { color } })
  return marks
}
function parseStyleDefinitions(documents: XmlDocument[]) {
  const names = new Map<string, string>()
  const styles: OdtStyle[] = []
  const listKinds = new Map<string, 'bulletList' | 'orderedList'>()
  const elements = documents.flatMap((document) => [
    ...Array.from(document.getElementsByTagName('*')).filter((element) => localName(element) === 'style'),
  ])
  for (const element of elements) {
    const name = attr(element, style, 'name') || element.getAttribute('style:name') || ''
    const family = attr(element, style, 'family') || element.getAttribute('style:family') || ''
    if (!name || !['paragraph', 'text'].includes(family)) continue
    const id = styleId(name)
    names.set(name, id)
    styles.push({
      id,
      kind: family === 'text' ? 'character' : 'paragraph',
      parent: attr(element, style, 'parent-style-name') || undefined,
      format: styleFormat(element, family),
      marks: marksFromStyle(element),
    })
  }
  for (const document of documents)
    for (const listStyle of Array.from(document.getElementsByTagName('*')).filter(
      (element) => localName(element) === 'list-style',
    )) {
      const name = attr(listStyle, style, 'name')
      const childrenOfList = descendants(listStyle, 'list-level-style-number')
      listKinds.set(name, childrenOfList.length ? 'orderedList' : 'bulletList')
    }
  const definitions: DocumentStyle[] = styles.map((entry) => ({
    id: entry.id,
    name: entry.id.replaceAll('_', ' '),
    kind: entry.kind,
    basedOn: entry.parent ? names.get(entry.parent) : undefined,
    builtIn: false,
    heading: entry.kind === 'paragraph' ? Number(/heading[_ ]?([1-6])/i.exec(entry.id)?.[1]) || undefined : undefined,
    format: entry.format,
  }))
  const all = readStyles(definitions)
  return { names, listKinds, styles: all, rawStyles: new Map(styles.map((item) => [item.id, item])) }
}

function styleMarks(name: string, styles: Map<string, OdtStyle>, names: Map<string, string>): DraftMark[] {
  const id = names.get(name) || styleId(name)
  const chain: OdtStyle[] = []
  const seen = new Set<string>()
  let current: OdtStyle | undefined = styles.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.unshift(current)
    current = current.parent ? styles.get(names.get(current.parent) || styleId(current.parent)) : undefined
  }
  const format = Object.assign({}, ...chain.map((entry) => entry.format)) as StyleFormat
  const marks: DraftMark[] = chain.flatMap((entry) => entry.marks)
  if (format.bold) marks.push({ type: 'bold' })
  if (format.italic) marks.push({ type: 'italic' })
  if (typeof format.color === 'string' || typeof format.fontFamily === 'string' || typeof format.fontSize === 'number')
    marks.push({
      type: 'textStyle',
      attrs: {
        ...(format.color ? { color: format.color } : {}),
        ...(format.fontFamily ? { fontFamily: format.fontFamily } : {}),
        ...(format.fontSize ? { fontSize: `${format.fontSize}pt` } : {}),
      },
    })
  return marks
}
function uniqueMarks(marks: DraftMark[]) {
  return [...new Map(marks.map((mark) => [`${mark.type}:${JSON.stringify(mark.attrs || {})}`, mark])).values()]
}
function safeArchivePath(path: string) {
  if (!path || path.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return undefined
  const parts: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '..') {
      if (!parts.length) return undefined
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}
function measure(value: string) {
  const parsed = points(value)
  return parsed ? Math.max(1, Math.min(16384, Math.round((parsed / 72) * 96))) : undefined
}

export function importOdt(input: ArrayBuffer | Uint8Array): ImportResult {
  const archive = unzipSync(input instanceof Uint8Array ? input : new Uint8Array(input))
  if (!archive['content.xml']) throw new Error('The ODT package does not contain content.xml.')
  const contentXml = parseXML(strFromU8(archive['content.xml']))
  const stylesXml = archive['styles.xml'] ? parseXML(strFromU8(archive['styles.xml'])) : undefined
  const metadataXml = archive['meta.xml'] ? parseXML(strFromU8(archive['meta.xml'])) : undefined
  const docs = [stylesXml, contentXml].filter((item): item is XmlDocument => Boolean(item))
  const styleData = parseStyleDefinitions(docs)
  const rawStyleMap = styleData.rawStyles
  const unsupported: UnsupportedContent[] = []
  const report = (kind: string) => {
    if (!unsupported.some((item) => item.kind === kind)) unsupported.push({ kind })
  }
  const images = archive
  function imageFromFrame(frame: XmlElement): DraftNode | undefined {
    const image = descendants(frame, 'image')[0]
    if (!image) {
      report('embedded object (not supported in ODT)')
      return undefined
    }
    const href = attr(image, xlink, 'href')
    const path = safeArchivePath(href)
    const bytes = path ? images[path] : undefined
    const mime = bytes && imageMime(bytes)
    if (!bytes || !mime) {
      report(
        href.startsWith('http:') || href.startsWith('https:')
          ? 'external image (not imported)'
          : 'image (missing or unsupported)',
      )
      return undefined
    }
    let src = bytesToDataURL(bytes, mime)
    if (mime === 'image/svg+xml') src = safeImageSource(src) || ''
    if (!src) {
      report('image (unsafe SVG)')
      return undefined
    }
    const title = descendants(frame, 'title')[0]?.textContent || ''
    const description = descendants(frame, 'desc')[0]?.textContent || ''
    return {
      type: 'image',
      attrs: {
        src,
        width: measure(attr(frame, svg, 'width')) || 300,
        height: measure(attr(frame, svg, 'height')) || 150,
        alt: description || title || attr(frame, draw, 'name'),
        alignment: 'inline',
        wrap: 'inline',
      },
    }
  }
  function inline(parent: XmlElement, inherited: DraftMark[] = []): DraftNode[] {
    const result: DraftNode[] = []
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 3) {
        const value = child.nodeValue || ''
        if (value && !(value.trim() === '' && /[\r\n\t]/.test(value)))
          result.push({ type: 'text', text: value, ...(inherited.length ? { marks: uniqueMarks(inherited) } : {}) })
        continue
      }
      if (child.nodeType !== 1) continue
      const element = child as XmlElement
      const tag = localName(element)
      if (tag === 's') {
        const count = Math.max(1, Math.min(1000, Number(attr(element, text, 'c')) || 1))
        result.push({
          type: 'text',
          text: ' '.repeat(count),
          ...(inherited.length ? { marks: uniqueMarks(inherited) } : {}),
        })
      } else if (tag === 'tab')
        result.push({ type: 'text', text: '\t', ...(inherited.length ? { marks: uniqueMarks(inherited) } : {}) })
      else if (tag === 'line-break') result.push({ type: 'hardBreak' })
      else if (tag === 'span') {
        const name = attr(element, text, 'style-name')
        const marks = name ? styleMarks(name, rawStyleMap, styleData.names) : []
        result.push(...inline(element, [...inherited, ...marks]))
      } else if (tag === 'a') {
        const href = safeLink(attr(element, xlink, 'href'))
        if (href) result.push(...inline(element, [...inherited, { type: 'link', attrs: { href } }]))
        else {
          report('link (unsafe or unsupported)')
          result.push(...inline(element, inherited))
        }
      } else if (tag === 'bookmark') {
        const id = attr(element, text, 'name')
          .replace(/[^A-Za-z0-9_-]/g, '_')
          .slice(0, 160)
        result.push({ type: 'bookmark', attrs: { id, name: id }, content: inline(element, inherited) })
      } else if (tag === 'frame') {
        const image = imageFromFrame(element)
        if (image) result.push(image)
      } else if (tag === 'note') {
        report('notes (not supported in ODT)')
        const body = descendants(element, 'note-body')[0]
        if (body) for (const p of children(body)) result.push(...inline(p, inherited))
      } else if (
        tag === 'bookmark-start' ||
        tag === 'bookmark-end' ||
        tag === 'reference-mark-start' ||
        tag === 'reference-mark-end'
      ) {
        // Heading anchors are attached while parsing the containing paragraph.
      } else {
        report(`${tag} (not supported in ODT)`)
        result.push(...inline(element, inherited))
      }
    }
    return result
  }
  function paragraph(element: XmlElement): DraftNode {
    const name = attr(element, text, 'style-name')
    const id = styleData.names.get(name) || (name ? styleId(name) : 'Normal')
    const outlineLevel = Number(attr(element, text, 'outline-level'))
    const resolved = styleData.styles.find((entry) => entry.id === id)
    const level = localName(element) === 'h' ? Math.max(1, Math.min(6, outlineLevel || resolved?.heading || 1)) : 0
    const bookmark = children(element).find((child) => ['bookmark-start', 'bookmark'].includes(localName(child)))
    const anchor = bookmark ? attr(bookmark, text, 'name') : ''
    return {
      type: level ? 'heading' : 'paragraph',
      attrs: { styleId: id, ...(level ? { level } : {}), ...(anchor ? { anchorId: anchor } : {}) },
      content: inline(element),
    }
  }
  function blocks(parent: XmlElement): DraftNode[] {
    const result: DraftNode[] = []
    for (const element of children(parent)) {
      const tag = localName(element)
      if (tag === 'p' || tag === 'h') result.push(paragraph(element))
      else if (tag === 'list') result.push(parseList(element))
      else if (tag === 'table') result.push(parseTable(element))
      else if (tag === 'section') result.push(...blocks(element))
      else if (tag === 'sequence-decls') continue
      else if (tag === 'tracked-changes' || tag === 'change-start' || tag === 'change-end')
        report('tracked changes (not supported in ODT)')
      else if (tag === 'frame') {
        const image = imageFromFrame(element)
        if (image) result.push({ type: 'paragraph', content: [image] })
      } else if (tag === 'annotation' || tag === 'annotation-end') report('comments (not supported in ODT)')
      else if (tag === 'ruby' || tag === 'alphabetical-index' || tag === 'table-of-content')
        report(`${tag} (not supported in ODT)`)
      else report(`${tag} (not supported in ODT)`)
    }
    return result
  }
  function parseList(element: XmlElement): DraftNode {
    const styleName = attr(element, text, 'style-name')
    const type = styleData.listKinds.get(styleName) || 'bulletList'
    const items: DraftNode[] = children(element)
      .filter((child) => ['list-item', 'list-header'].includes(localName(child)))
      .map((item) => ({ type: 'listItem', content: blocks(item) }))
    for (const nested of children(element).filter((child) => localName(child) === 'list'))
      items.push(...(parseList(nested).content || []))
    return { type, attrs: {}, content: items }
  }
  function parseTable(element: XmlElement): DraftNode {
    const rows: DraftNode[] = []
    for (const container of children(element)) {
      const headerRows = localName(container) === 'table-header-rows'
      const rowElements = localName(container) === 'table-row' ? [container] : descendants(container, 'table-row')
      for (const row of rowElements) {
        const cells = children(row).flatMap((cell) => {
          if (localName(cell) === 'covered-table-cell') return []
          if (localName(cell) !== 'table-cell') return []
          const colspan = Number(attr(cell, table, 'number-columns-spanned')) || 1
          const rowspan = Number(attr(cell, table, 'number-rows-spanned')) || 1
          if (colspan > 1 || rowspan > 1) report('merged table cells (partially supported in ODT)')
          return [
            {
              type: headerRows ? 'tableHeader' : 'tableCell',
              attrs: { colspan: Math.max(1, Math.min(100, colspan)), rowspan: Math.max(1, Math.min(100, rowspan)) },
              content: blocks(cell),
            } as DraftNode,
          ]
        })
        rows.push({ type: 'tableRow', content: cells })
      }
    }
    return { type: 'table', attrs: { layout: 'fixed' }, content: rows }
  }

  const body = Array.from(contentXml.getElementsByTagName('*')).find((element) => localName(element) === 'text')
  if (!body) throw new Error('The ODT package does not contain office:text.')
  const document: DraftDocument = normalizeReferences({
    type: 'doc',
    attrs: {
      columns: 1,
      pageSetup: JSON.stringify(readPageSetup(stylesXml)),
      styleDefinitions: JSON.stringify(styleData.styles),
    },
    content: blocks(body),
  })
  const language =
    metadataXml &&
    Array.from(metadataXml.getElementsByTagName('*'))
      .find((element) => localName(element) === 'language')
      ?.textContent?.trim()
  return {
    document: document.content.length
      ? document
      : { type: 'doc', attrs: { ...document.attrs }, content: [{ type: 'paragraph' }] },
    language,
    unsupported,
  }
}

function readPageSetup(document?: XmlDocument): PageSetup {
  const layout =
    document &&
    Array.from(document.getElementsByTagName('*')).find((element) => localName(element) === 'page-layout-properties')
  if (!layout) return { ...DEFAULT_PAGE_SETUP }
  const twips = (name: string, fallback: number) => {
    const value = points(attr(layout, fo, name))
    return value === undefined ? fallback : Math.round(value * 20)
  }
  const width = twips('page-width', DEFAULT_PAGE_SETUP.width)
  const height = twips('page-height', DEFAULT_PAGE_SETUP.height)
  const page = validatePageSetup({
    ...DEFAULT_PAGE_SETUP,
    width,
    height,
    orientation: width > height ? 'landscape' : 'portrait',
    top: twips('margin-top', DEFAULT_PAGE_SETUP.top),
    right: twips('margin-right', DEFAULT_PAGE_SETUP.right),
    bottom: twips('margin-bottom', DEFAULT_PAGE_SETUP.bottom),
    left: twips('margin-left', DEFAULT_PAGE_SETUP.left),
  })
  if (!page) return { ...DEFAULT_PAGE_SETUP }
  return page
}
