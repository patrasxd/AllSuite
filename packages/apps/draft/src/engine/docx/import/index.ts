import { strFromU8, unzipSync } from 'fflate'
import { parseChart, renderChart } from './charts'
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom'
import type { DraftDocument, DraftMark, DraftNode, ImportResult, UnsupportedContent } from '../../document-model'
import { twipsToLineSpacing, twipsToPoints } from '../../paragraph'
import { bytesToDataURL, imageMime, sanitizeSVG } from '../../images'
import { readStyles, type DocumentStyle, type StyleFormat } from '../../styles'
import { normalizeReferences, safeLink, validTargetId, nodeText, validCaptionLabel } from '../../references'
import { DEFAULT_PAGE_SETUP, validatePageSetup, type PageSetup } from '../../page-setup'
import { emptyStories, emptyStory, validateStories, type Stories, type StoryVariant } from '../../stories'
import { serializeCommentThreads, type CommentReply, type CommentThread } from '../../comments'
import { ommlElementToLatex } from '../../math'

class DocxRelationships extends Map<string, string> {
  story = false
  images = new Map<string, string>()
  charts = new Map<string, ReturnType<typeof renderChart>>()
  chartReports: UnsupportedContent[] = []
  unsupportedImages = new Set<string>()
  unsupportedFields = new Set<string>()
  commentIds = new Map<string, string>()
  activeComments = new Set<string>()
}

function loadChart(item: Element, files: Record<string, Uint8Array>, rels: DocxRelationships) {
  const id = item.getAttribute('Id')
  const target = item.getAttribute('Target')
  if (
    !id ||
    !target ||
    !/\/chart$/.test(item.getAttribute('Type') || '') ||
    item.getAttribute('TargetMode') === 'External'
  )
    return
  const segments: string[] = []
  for (const part of (target.startsWith('/') ? target.slice(1) : `word/${target}`).split('/')) {
    if (part === '..') segments.pop()
    else if (part !== '.') segments.push(part)
  }
  const path = segments.join('/')
  const bytes = /^word\/charts\/[^/]+\.xml$/.test(path) ? files[path] : undefined
  if (bytes) {
    try {
      rels.charts.set(id, renderChart(parseChart(strFromU8(bytes))))
    } catch {
      /* Report at the drawing position. */
    }
  }
}

function descendant(element: Element, local: string) {
  return Array.from(element.getElementsByTagName('*')).find((node) => name(node) === local)
}

function drawingImage(drawing: Element, rels: DocxRelationships): DraftNode | undefined {
  const chart = descendant(drawing, 'chart')
  if (chart) {
    const id = chart.getAttributeNS(relationships, 'id') || chart.getAttribute('r:id') || ''
    const rendered = rels.charts.get(id)
    if (!rendered) {
      rels.chartReports.push({ kind: 'chart — could not be rendered' })
      return undefined
    }
    const report = `chart (${rendered.alt}) — ${rendered.supported ? 'converted to images' : 'could not be rendered'}`
    rels.chartReports.push({ kind: report })
    const extent = descendant(drawing, 'extent')
    return {
      type: 'image',
      attrs: {
        src: bytesToDataURL(new TextEncoder().encode(rendered.svg), 'image/svg+xml'),
        width: Math.max(1, Math.min(16384, Number(extent?.getAttribute('cx')) / 9525 || 640)),
        height: Math.max(1, Math.min(16384, Number(extent?.getAttribute('cy')) / 9525 || 380)),
        alt: rendered.alt,
        alignment: 'inline',
        wrap: 'inline',
        importChart: report,
      },
    }
  }
  const blip = descendant(drawing, 'blip')
  const svg = descendant(drawing, 'svgBlip')
  const embed = (element?: Element) =>
    element?.getAttributeNS(relationships, 'embed') || element?.getAttribute('r:embed') || ''
  const fallbackSrc = rels.images.get(embed(blip))
  const svgSrc = svg && rels.images.get(embed(svg))
  const src = svgSrc || fallbackSrc
  if (!src) {
    rels.unsupportedImages.add('image (missing, external or unsupported)')
    return undefined
  }
  const extent = descendant(drawing, 'extent')
  const docPr = descendant(drawing, 'docPr')
  const anchor = descendant(drawing, 'anchor')
  const position = anchor && descendant(anchor, 'positionH')
  const align = position && descendant(position, 'align')?.textContent
  const square = anchor && descendant(anchor, 'wrapSquare')
  const storedLayout = /^Draft image\|(inline|left|center|right)\|(inline|square-left|square-right|top-bottom)$/.exec(
    docPr?.getAttribute('name') || '',
  )
  const wrap =
    anchor && descendant(anchor, 'wrapTopAndBottom')
      ? 'top-bottom'
      : square
        ? square.getAttribute('wrapText') === 'left' || align === 'right'
          ? 'square-right'
          : 'square-left'
        : 'inline'
  return {
    type: 'image',
    attrs: {
      src,
      fallbackSrc: svgSrc && fallbackSrc ? fallbackSrc : null,
      width: Math.max(1, Math.min(16384, Number(extent?.getAttribute('cx')) / 9525 || 300)),
      height: Math.max(1, Math.min(16384, Number(extent?.getAttribute('cy')) / 9525 || 150)),
      alt: docPr?.getAttribute('descr') || docPr?.getAttribute('title') || '',
      alignment: storedLayout?.[1] || (align === 'left' || align === 'right' || align === 'center' ? align : 'inline'),
      wrap: storedLayout?.[2] || wrap,
    },
  }
}

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const highlightColors: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#000080',
  darkRed: '#800000',
  darkYellow: '#808000',
  darkGreen: '#008000',
  darkCyan: '#008080',
  darkMagenta: '#800080',
  black: '#000000',
  white: '#ffffff',
}

function parseXml(xml: string, label: string): XMLDocument {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  if (parsed.getElementsByTagName('parsererror').length) throw new Error(`Invalid ${label} XML`)
  return parsed as unknown as XMLDocument
}

function name(element: Element) {
  return element.localName || element.tagName.split(':').pop() || ''
}

function parseComments(files: Record<string, Uint8Array>) {
  const threads: CommentThread[] = []
  const commentIds = new Map<string, string>()
  if (!files['word/comments.xml']) return { threads, commentIds }
  let comments: XMLDocument
  try {
    comments = parseXml(strFromU8(files['word/comments.xml']), 'comments')
  } catch {
    return { threads, commentIds }
  }
  const extended = new Map<string, { parent?: string; done: boolean }>()
  if (files['word/commentsExtended.xml'])
    try {
      const xml = parseXml(strFromU8(files['word/commentsExtended.xml']), 'extended comments')
      for (const entry of Array.from(xml.getElementsByTagName('*')).filter((node) => name(node) === 'commentEx')) {
        const paraId = entry.getAttribute('w15:paraId') || entry.getAttribute('paraId') || ''
        if (!paraId) continue
        extended.set(paraId, {
          parent: entry.getAttribute('w15:paraIdParent') || entry.getAttribute('paraIdParent') || undefined,
          done: ['1', 'true'].includes(entry.getAttribute('w15:done') || entry.getAttribute('done') || ''),
        })
      }
    } catch {
      /* Basic comment text and anchors remain importable. */
    }
  const records = Array.from(comments.getElementsByTagNameNS(word, 'comment')).map((comment) => {
    const numericId = attr(comment, 'id') || ''
    const paragraphs = children(comment, 'p')
    const paraId = paragraphs[0]?.getAttribute('w14:paraId') || paragraphs[0]?.getAttribute('paraId') || ''
    const text = paragraphs
      .map((paragraph) =>
        Array.from(paragraph.getElementsByTagNameNS(word, 't'))
          .map((run) => run.textContent || '')
          .join(''),
      )
      .join('\n')
      .trim()
    return {
      numericId,
      id: `docx-${numericId}`,
      author: attr(comment, 'author') || 'Guest',
      text,
      paraId,
      parent: extended.get(paraId)?.parent,
      resolved: extended.get(paraId)?.done || false,
    }
  })
  const byParaId = new Map(records.filter((record) => record.paraId).map((record) => [record.paraId, record]))
  const threadByRecord = new Map<string, CommentThread>()
  for (const record of records) {
    if (!record.text || !/^\d+$/.test(record.numericId)) continue
    if (record.parent) {
      const parent = byParaId.get(record.parent)
      const root = parent && threadByRecord.get(parent.numericId)
      if (root) {
        const reply: CommentReply = {
          id: `docx-reply-${record.numericId}`,
          author: record.author || 'Guest',
          text: record.text,
        }
        root.replies.push(reply)
        threadByRecord.set(record.numericId, root)
        commentIds.set(record.numericId, root.id)
        continue
      }
    }
    const thread: CommentThread = {
      id: record.id,
      author: record.author || 'Guest',
      text: record.text,
      resolved: record.resolved,
      replies: [],
    }
    threads.push(thread)
    threadByRecord.set(record.numericId, thread)
    commentIds.set(record.numericId, thread.id)
  }
  return { threads, commentIds }
}

function children(element: Element, localName?: string) {
  return Array.from(element.children).filter((child) => !localName || name(child) === localName)
}

function first(element: Element | Document, localName: string) {
  return (
    Array.from(element.getElementsByTagNameNS(word, localName))[0] ||
    Array.from(element.getElementsByTagName(`w:${localName}`))[0]
  )
}

function attr(element: Element | undefined, localName: string) {
  return (
    element?.getAttributeNS(word, localName) ||
    element?.getAttribute(`w:${localName}`) ||
    element?.getAttribute(localName) ||
    undefined
  )
}

function int(value: string | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function hex(value: string | undefined) {
  return value && /^[\da-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : undefined
}

function paraAttrs(paragraph: Element) {
  const properties = children(paragraph, 'pPr')[0]
  if (!properties) return undefined
  const attrs: Record<string, string | number | boolean | number[]> = {}
  for (const name of ['keepNext', 'keepLines', 'widowControl']) {
    const value = children(properties, name)[0]
    if (value) attrs[name] = !['0', 'false', 'off'].includes(attr(value, 'val') || 'true')
  }
  if (
    children(properties, 'pageBreakBefore').some((node) => !['0', 'false', 'off'].includes(attr(node, 'val') || 'true'))
  )
    attrs.pageBreakBefore = 1
  const align = attr(children(properties, 'jc')[0], 'val')
  if (align && { left: true, center: true, right: true, both: true, justify: true }[align])
    attrs.textAlign = align === 'both' ? 'justify' : align
  const spacing = children(properties, 'spacing')[0]
  const before = int(attr(spacing, 'before'))
  const after = int(attr(spacing, 'after'))
  const line = int(attr(spacing, 'line'))
  if (before !== undefined) attrs.spacingBefore = twipsToPoints(before)!
  if (after !== undefined) attrs.spacingAfter = twipsToPoints(after)!
  if (line !== undefined) attrs.lineSpacing = twipsToLineSpacing(line)!
  const indentation = children(properties, 'ind')[0]
  const left = int(attr(indentation, 'left') || attr(indentation, 'start'))
  const right = int(attr(indentation, 'right') || attr(indentation, 'end'))
  const firstLine = int(attr(indentation, 'firstLine'))
  const hanging = int(attr(indentation, 'hanging'))
  if (left !== undefined) attrs.indentLeft = twipsToPoints(left)!
  if (right !== undefined) attrs.indentRight = twipsToPoints(right)!
  if (firstLine !== undefined) attrs.indentFirstLine = twipsToPoints(firstLine)!
  if (hanging !== undefined) attrs.indentHanging = twipsToPoints(hanging)!
  const tabs = first(properties, 'tabs')
  const tabStops = tabs
    ? children(tabs, 'tab')
        .filter((tab) => attr(tab, 'val') === 'left')
        .map((tab) => twipsToPoints(int(attr(tab, 'pos'))))
        .filter((value): value is number => value !== undefined)
    : []
  if (tabStops.length) attrs.tabStops = tabStops
  return Object.keys(attrs).length ? attrs : undefined
}

class DocxStyles extends Map<string, DocumentStyle> {
  defaultParagraph = 'Normal'
}
function formatProperties(element: Element): StyleFormat {
  const formatting = marks(element) || []
  const text = formatting.find((mark) => mark.type === 'textStyle')?.attrs
  return {
    ...paraAttrs(element),
    ...(text?.fontFamily ? { fontFamily: String(text.fontFamily) } : {}),
    ...(text?.fontSize ? { fontSize: Number.parseFloat(String(text.fontSize)) } : {}),
    ...(text?.color ? { color: String(text.color) } : {}),
    ...(formatting.some((mark) => mark.type === 'bold')
      ? { bold: true }
      : text?.styleBold === false
        ? { bold: false }
        : {}),
    ...(formatting.some((mark) => mark.type === 'italic')
      ? { italic: true }
      : text?.styleItalic === false
        ? { italic: false }
        : {}),
  } as StyleFormat
}
function styleMap(styles?: XMLDocument) {
  const map = new DocxStyles()
  const definitions: DocumentStyle[] = []
  if (!styles) {
    for (const style of readStyles(null)) map.set(style.id, style)
    return map
  }
  const defaults = first(styles, 'docDefaults')
  const defaultFormat: StyleFormat = defaults
    ? {
        ...(first(defaults, 'pPrDefault') ? formatProperties(first(defaults, 'pPrDefault')) : {}),
        ...(first(defaults, 'rPrDefault') ? formatProperties(first(defaults, 'rPrDefault')) : {}),
      }
    : {}
  for (const style of Array.from(styles.getElementsByTagNameNS(word, 'style'))) {
    const id = attr(style, 'styleId')
    const kind = attr(style, 'type')
    if (!id || (kind !== 'paragraph' && kind !== 'character')) continue
    const label = attr(first(style, 'name'), 'val') || id
    const match = /heading([1-6])/.exec(`${id} ${label}`.toLowerCase().replaceAll(' ', ''))
    const outline = int(attr(first(style, 'outlineLvl'), 'val'))
    const basedOn = attr(first(style, 'basedOn'), 'val')
    definitions.push({
      id,
      name: label,
      kind,
      basedOn,
      next: attr(first(style, 'next'), 'val'),
      builtIn: attr(style, 'customStyle') !== '1',
      heading: match ? Number(match[1]) : outline !== undefined && outline <= 5 ? outline + 1 : undefined,
      format: { ...(!basedOn && kind === 'paragraph' ? defaultFormat : {}), ...formatProperties(style) },
    })
    if (kind === 'paragraph' && ['1', 'true'].includes(attr(style, 'default') || '')) map.defaultParagraph = id
  }
  for (const style of readStyles(definitions)) map.set(style.id, style)
  for (const style of map.values()) {
    const seen = new Set([style.id])
    let base = style.basedOn && map.get(style.basedOn)
    while (base && !seen.has(base.id)) {
      seen.add(base.id)
      if (base.heading) {
        style.heading ??= base.heading
        break
      }
      base = base.basedOn && map.get(base.basedOn)
    }
  }
  return map
}

type Numbering = Map<string, Map<number, 'bulletList' | 'orderedList'>>
function numberingMap(numbering?: XMLDocument): Numbering {
  const abstract = new Map<string, Map<number, 'bulletList' | 'orderedList'>>()
  const result: Numbering = new Map()
  if (!numbering) return result
  for (const item of Array.from(numbering.getElementsByTagNameNS(word, 'abstractNum'))) {
    const levels = new Map<number, 'bulletList' | 'orderedList'>()
    for (const level of children(item, 'lvl')) {
      const index = int(attr(level, 'ilvl')) ?? 0
      levels.set(index, attr(first(level, 'numFmt'), 'val') === 'bullet' ? 'bulletList' : 'orderedList')
    }
    const id = attr(item, 'abstractNumId')
    if (id) abstract.set(id, levels)
  }
  for (const item of Array.from(numbering.getElementsByTagNameNS(word, 'num'))) {
    const id = attr(item, 'numId')
    const abstractId = attr(first(item, 'abstractNumId'), 'val')
    if (id && abstractId && abstract.has(abstractId)) result.set(id, abstract.get(abstractId)!)
  }
  return result
}

function marksFromProperties(properties?: Element): DraftMark[] {
  if (!properties) return []
  const current = properties.cloneNode(false) as Element
  for (const child of children(properties)) if (name(child) !== 'rPrChange') current.appendChild(child.cloneNode(true))
  const result: DraftMark[] = []
  const textStyle: Record<string, string | boolean> = {}
  for (const [tag, type, override] of [
    ['b', 'bold', 'styleBold'],
    ['i', 'italic', 'styleItalic'],
  ] as const) {
    const property = first(current, tag)
    if (property) {
      if (['0', 'false', 'off'].includes(attr(property, 'val') || '')) textStyle[override] = false
      else result.push({ type })
    }
  }
  const characterStyle = attr(first(current, 'rStyle'), 'val')
  if (characterStyle) result.push({ type: 'characterStyle', attrs: { styleId: characterStyle } })
  const underline = attr(first(current, 'u'), 'val')
  if (underline && underline !== 'none') result.push({ type: 'underline' })
  if (first(current, 'strike') || first(current, 'dstrike')) result.push({ type: 'strike' })
  const color = hex(attr(first(current, 'color'), 'val'))
  if (color && color !== '#auto') textStyle.color = color
  const highlight = attr(first(current, 'highlight'), 'val')
  if (highlight && highlightColors[highlight])
    result.push({ type: 'highlight', attrs: { color: highlightColors[highlight] } })
  const size = int(attr(first(current, 'sz'), 'val'))
  if (size) textStyle.fontSize = `${size / 2}pt`
  const family = attr(first(current, 'rFonts'), 'ascii') || attr(first(current, 'rFonts'), 'hAnsi')
  if (family) textStyle.fontFamily = family
  const vertical = attr(first(current, 'vertAlign'), 'val')
  if (vertical === 'subscript' || vertical === 'superscript') result.push({ type: vertical })
  if (Object.keys(textStyle).length) result.push({ type: 'textStyle', attrs: textStyle })
  return result
}

let revisionSequence = 0
function marks(run: Element): DraftMark[] | undefined {
  const properties = children(run, 'rPr')[0]
  if (!properties) return undefined
  const result = marksFromProperties(properties)
  const change = children(properties, 'rPrChange')[0]
  const previous = children(change || properties, 'rPr')[0]
  if (change && previous) {
    result.push({
      type: 'suggestion',
      attrs: {
        id: `docx-format-${attr(change, 'id') || ++revisionSequence}`,
        kind: 'format',
        author: attr(change, 'author') || 'Guest',
        timestamp: attr(change, 'date') || '',
        before: JSON.stringify(marksFromProperties(previous)),
      },
    })
  }
  return result.length ? result : undefined
}

function runContent(run: Element, rels: DocxRelationships, inherited?: DraftMark[]) {
  const content: DraftNode[] = []
  const runMarks = [
    ...(marks(run) || []),
    ...(inherited || []),
    ...Array.from(rels.activeComments, (id) => ({ type: 'comment', attrs: { id } })),
  ]
  for (const child of children(run)) {
    if (['fldChar', 'instrText'].includes(name(child))) rels.unsupportedFields.add('field')
    if (name(child) === 'footnoteReference' || name(child) === 'endnoteReference') {
      const kind = name(child) === 'footnoteReference' ? 'footnote' : 'endnote'
      content.push({ type: 'noteReference', attrs: { id: `${kind}_${attr(child, 'id')}`, kind } })
    }
    if (name(child) === 'drawing') {
      const image = drawingImage(child, rels)
      if (image) content.push(image)
    }
    if (name(child) === 't' || name(child) === 'delText')
      content.push({ type: 'text', text: child.textContent || '', marks: runMarks.length ? runMarks : undefined })
    if (name(child) === 'tab') content.push({ type: 'text', text: '\t', marks: runMarks.length ? runMarks : undefined })
    if (name(child) === 'br' || name(child) === 'cr')
      content.push({
        type: attr(child, 'type') === 'page' ? 'pageBreak' : 'hardBreak',
        marks: runMarks.length ? runMarks : undefined,
      })
  }
  return content
}

function knownReferenceField(instruction: string, cached: DraftNode[], target: DraftNode[]): DraftNode | undefined {
  const clean = instruction.replace(/\s+\\\*\s+MERGEFORMAT\s*$/i, '').trim()
  const ref = /^(REF|PAGEREF)\s+([A-Za-z_][\w-]{0,159})((?:\s+\\[hn])*)$/i.exec(clean)
  if (ref) {
    const numbered = ref[2].endsWith('_number') || /\\n\b/i.test(ref[3])
    return {
      type: 'crossReference',
      attrs: {
        targetId: ref[2].endsWith('_number') ? ref[2].slice(0, -7) : ref[2],
        ...(ref[2].endsWith('_number') ? { numberBookmark: ref[2] } : {}),
        format: ref[1].toUpperCase() === 'PAGEREF' ? 'page' : numbered ? 'number' : 'text',
        label: cached.map(nodeText).join(''),
      },
    }
  }
  const seq = /^SEQ\s+(?:"([^"]+)"|([\p{L}_][\p{L}\p{N}_-]*))(?:\s+\\\*\s+ARABIC)?$/iu.exec(clean)
  if (seq && validCaptionLabel(seq[1] || seq[2])) {
    const label = seq[1] || seq[2],
      prefix = `${label} `,
      last = target.at(-1)
    const showLabel = last?.type === 'text' && !!last.text?.endsWith(prefix)
    if (showLabel) {
      last!.text = last!.text!.slice(0, -prefix.length)
      if (!last!.text) target.pop()
    }
    return {
      type: 'captionNumber',
      attrs: { label, number: Math.max(1, Number(cached.map(nodeText).join('')) || 1), showLabel },
      marks: cached[0]?.marks,
    }
  }
}
function paragraphContent(paragraph: Element, rels: DocxRelationships, inherited?: DraftMark[]) {
  const content: DraftNode[] = []
  let target = content
  const bookmarks: Array<{ id: string; parent: DraftNode[] }> = []
  const elements = children(paragraph)
  for (let index = 0; index < elements.length; index++) {
    const child = elements[index]
    if (name(child) === 'oMath' || name(child) === 'oMathPara') {
      const math = name(child) === 'oMathPara' ? descendant(child, 'oMath') : child
      const latex = math && ommlElementToLatex(math as unknown as XmlElement)
      if (latex !== null && latex !== undefined)
        target.push({ type: name(child) === 'oMathPara' ? 'mathBlock' : 'mathInline', attrs: { latex } })
      else rels.unsupportedFields.add('equation (unsupported OMML structure)')
      continue
    }
    if (name(child) === 'ins' || name(child) === 'del') {
      const kind = name(child) === 'ins' ? 'insert' : 'delete'
      const revision: DraftMark = {
        type: 'suggestion',
        attrs: {
          id: `docx-${kind}-${attr(child, 'id') || ++revisionSequence}`,
          kind,
          author: attr(child, 'author') || 'Guest',
          timestamp: attr(child, 'date') || '',
        },
      }
      const marks = [...(inherited || []), revision]
      for (const part of children(child)) target.push(...paragraphContentWrapper(part, rels, marks))
      continue
    }
    if (name(child) === 'commentRangeStart') {
      const id = attr(child, 'id')
      const threadId = id && rels.commentIds.get(id)
      if (threadId) rels.activeComments.add(threadId)
      continue
    }
    if (name(child) === 'commentRangeEnd') {
      const id = attr(child, 'id')
      const threadId = id && rels.commentIds.get(id)
      if (threadId) rels.activeComments.delete(threadId)
      continue
    }
    if (name(child) === 'bookmarkStart' && validTargetId(attr(child, 'name'))) {
      const bookmark: DraftNode = {
        type: 'bookmark',
        attrs: { id: attr(child, 'name')!, name: attr(child, 'name')! },
        content: [],
      }
      target.push(bookmark)
      bookmarks.push({ id: attr(child, 'id') || '', parent: target })
      target = bookmark.content!
    }
    if (name(child) === 'bookmarkEnd' && bookmarks.at(-1)?.id === attr(child, 'id')) target = bookmarks.pop()!.parent
    const instruction = name(child) === 'fldSimple' ? attr(child, 'instr') : undefined
    if (instruction !== undefined) {
      const cached = paragraphContent(child, rels, inherited)
      const storyField = rels.story && /^\s*(PAGE|NUMPAGES|TITLE)(?:\s+\\\*\s+MERGEFORMAT)?\s*$/i.exec(instruction)
      if (storyField) {
        target.push({ type: 'storyField', attrs: { field: storyField[1].toUpperCase() }, marks: cached[0]?.marks })
        continue
      }
      const known = knownReferenceField(instruction, cached, target)
      if (known) {
        target.push(known)
        continue
      }
      const match = /^\s*REF\s+([A-Za-z_][\w-]{0,159})(?:\s+\\h)?\s*$/i.exec(instruction)
      if (match)
        target.push({ type: 'crossReference', attrs: { targetId: match[1], label: cached.map(nodeText).join('') } })
      else {
        rels.unsupportedFields.add('field')
        target.push(...cached)
      }
      continue
    }
    if (name(child) === 'r' && attr(first(child, 'fldChar'), 'fldCharType') === 'begin') {
      let depth = 1
      let instruction = ''
      let separated = false
      const cached: DraftNode[] = []
      let end = index + 1
      for (; end < elements.length; end++) {
        const part = elements[end]
        const field = attr(first(part, 'fldChar'), 'fldCharType')
        if (field === 'begin') depth++
        if (field === 'end' && --depth === 0) break
        if (!separated) instruction += first(part, 'instrText')?.textContent || ''
        if (field === 'separate') separated = true
        else if (separated) cached.push(...paragraphContentWrapper(part, rels, inherited))
      }
      const match = /^\s*REF\s+([A-Za-z_][\w-]{0,159})(?:\s+\\h)?\s*$/i.exec(instruction)
      const storyField = rels.story && /^\s*(PAGE|NUMPAGES|TITLE)(?:\s+\\\*\s+MERGEFORMAT)?\s*$/i.exec(instruction)
      const known = end < elements.length ? knownReferenceField(instruction, cached, target) : undefined
      if (known) target.push(known)
      else if (end < elements.length && storyField)
        target.push({ type: 'storyField', attrs: { field: storyField[1].toUpperCase() }, marks: cached[0]?.marks })
      else if (end < elements.length && match)
        target.push({ type: 'crossReference', attrs: { targetId: match[1], label: cached.map(nodeText).join('') } })
      else {
        rels.unsupportedFields.add('field')
        target.push(...cached)
      }
      index = end
      continue
    }
    if (name(child) === 'r') target.push(...runContent(child, rels, inherited))
    if (name(child) === 'hyperlink') {
      const href = safeLink(
        attr(child, 'anchor')
          ? `#${attr(child, 'anchor')}`
          : child.getAttributeNS(relationships, 'id')
            ? rels.get(child.getAttributeNS(relationships, 'id')!)
            : undefined,
      )
      const link: DraftMark[] | undefined = href
        ? [
            {
              type: 'link',
              attrs: { href, target: href.startsWith('#') ? null : '_blank', rel: 'noopener noreferrer' },
            },
          ]
        : undefined
      for (const part of children(child))
        target.push(...paragraphContentWrapper(part, rels, [...(inherited || []), ...(link || [])]))
    }
  }
  if (bookmarks.length) rels.unsupportedFields.add('bookmark across paragraphs (partial range)')
  return content
}

function paragraphContentWrapper(element: Element, rels: DocxRelationships, inherited?: DraftMark[]): DraftNode[] {
  if (name(element) === 'r') return runContent(element, rels, inherited)
  const wrapper = element.ownerDocument.createElementNS(word, 'w:p')
  wrapper.appendChild(element.cloneNode(true))
  return paragraphContent(wrapper, rels, inherited)
}

function listInfo(paragraph: Element, numbering: Numbering) {
  const properties = children(paragraph, 'pPr')[0]
  const number = properties && children(properties, 'numPr')[0]
  const id = attr(first(number || paragraph, 'numId'), 'val')
  if (!id || !numbering.has(id)) return undefined
  const level = int(attr(first(number, 'ilvl'), 'val')) ?? 0
  return { level, type: numbering.get(id)?.get(level) || 'orderedList' }
}

function paragraphNode(paragraph: Element, rels: DocxRelationships, styles: DocxStyles) {
  const properties = children(paragraph, 'pPr')[0]
  const style = attr(first(properties || paragraph, 'pStyle'), 'val') || styles.defaultParagraph
  const heading = styles.get(style)?.heading
  const flatten = (nodes: DraftNode[], parentIds: string[] = []): DraftNode[] =>
    nodes.flatMap((node) =>
      node.type === 'bookmark' &&
      parentIds.some((id) => node.attrs?.id === `${id}_number`) &&
      node.content?.some((child) => child.type === 'captionNumber')
        ? node.content
        : [
            {
              ...node,
              ...(node.content
                ? {
                    content: flatten(
                      node.content,
                      node.type === 'bookmark' ? [...parentIds, String(node.attrs?.id)] : parentIds,
                    ),
                  }
                : {}),
            },
          ],
    )
  const content = flatten(paragraphContent(paragraph, rels))
  if (style === 'DraftCodeBlock') {
    const text = content
      .map((node) => (node.type === 'hardBreak' ? '\n' : node.type === 'text' ? node.text || '' : ''))
      .join('')
    const language = /^\[([a-z0-9+#-]{1,24})\]\n/i.exec(text)
    const code = language ? text.slice(language[0].length) : text
    return {
      type: 'codeBlock',
      attrs: language ? { language: language[1].toLowerCase() } : {},
      content: code ? [{ type: 'text', text: code }] : [],
    } satisfies DraftNode
  }
  if (content.length === 1 && content[0].type === 'mathBlock') return content[0]
  for (const node of content) if (node.type === 'mathBlock') node.type = 'mathInline'
  const sequence = (nodes: DraftNode[]): DraftNode | undefined =>
    nodes.find((node) => node.type === 'captionNumber') ||
    nodes
      .flatMap((node) => node.content || [])
      .map((node) => sequence([node]))
      .find(Boolean)
  const caption = sequence(content)
  const anchor = (heading || caption) && content.length === 1 && content[0].type === 'bookmark' ? content[0] : undefined
  const alignment = paraAttrs(paragraph)?.textAlign
  for (const node of content)
    if (node.type === 'image' && node.attrs?.alignment === 'inline' && ['center', 'right'].includes(String(alignment)))
      node.attrs!.alignment = alignment!
  return {
    type: heading ? 'heading' : 'paragraph',
    attrs: {
      ...(heading ? { level: heading } : {}),
      ...(anchor ? { anchorId: anchor.attrs!.id } : {}),
      ...(caption ? { captionLabel: caption.attrs!.label, captionPosition: 'below' } : {}),
      styleId: style,
      ...paraAttrs(paragraph),
    },
    content: anchor ? anchor.content : content,
  } satisfies DraftNode
}

function appendList(
  target: DraftNode[],
  node: DraftNode,
  info: { level: number; type: 'bulletList' | 'orderedList' },
  stack: DraftNode[],
) {
  while (stack.length > info.level + 1) stack.pop()
  while (stack.length < info.level + 1) {
    const nested: DraftNode = { type: info.type, content: [] }
    const parent = stack[stack.length - 1]
    const item = parent?.content?.[parent.content.length - 1]
    if (item?.content) item.content.push(nested)
    else target.push(nested)
    stack.push(nested)
  }
  let list = stack[info.level]
  if (list.type !== info.type) {
    list = { type: info.type, content: [] }
    if (info.level === 0) target.push(list)
    else stack[info.level - 1].content?.[stack[info.level - 1].content!.length - 1]?.content?.push(list)
    stack[info.level] = list
  }
  // List items require a paragraph first; the named heading style retains outline semantics.
  list.content?.push({ type: 'listItem', content: [node.type === 'heading' ? { ...node, type: 'paragraph' } : node] })
}

function tableNode(table: Element, rels: DocxRelationships, styles: DocxStyles): DraftNode {
  const props = children(table, 'tblPr')[0]
  const grid = children(table, 'tblGrid')[0]
  const widths = grid ? children(grid, 'gridCol').map((col) => (int(attr(col, 'w')) || 1440) / 15) : []
  const alignment = props && attr(first(props, 'jc'), 'val')
  const look = props && first(props, 'tblLook')
  const hasHeader =
    attr(look, 'firstRow') === '1' ||
    attr(look, 'firstRow') === 'true' ||
    Boolean(parseInt(attr(look, 'val') || '0', 16) & 0x20)
  const active = new Map<number, DraftNode>()
  const rows: DraftNode[] = []
  const borderStyle = (edge: Element | undefined) => {
    if (!edge) return undefined
    const style = attr(edge, 'val')
    return style === 'nil' || style === 'none'
      ? '0px none'
      : `${(int(attr(edge, 'sz')) || 8) / 6}px solid ${hex(attr(edge, 'color')) || '#808080'}`
  }
  const sourceRows = children(table, 'tr')
  sourceRows.forEach((row, rowIndex) => {
    const rowProps = children(row, 'trPr')[0]
    const headerProperty = rowProps && first(rowProps, 'tblHeader')
    const repeatHeader = Boolean(
      headerProperty && !['0', 'false', 'off'].includes(attr(headerProperty, 'val') || 'true'),
    )
    const cells: DraftNode[] = []
    let column = Number(attr(rowProps && first(rowProps, 'gridBefore'), 'val')) || 0
    for (const tc of children(row, 'tc')) {
      const cp = children(tc, 'tcPr')[0]
      const span = Math.max(1, Math.min(100, Number(attr(cp && first(cp, 'gridSpan'), 'val')) || 1))
      const merge = cp && first(cp, 'vMerge')
      if (merge && attr(merge, 'val') !== 'restart' && active.has(column)) {
        const previous = active.get(column)!
        previous.attrs!.rowspan = Number(previous.attrs!.rowspan) + 1
        column += span
        continue
      }
      const attrs: NonNullable<DraftNode['attrs']> = { colspan: span, rowspan: 1 }
      const colwidth = widths.slice(column, column + span)
      if (colwidth.length === span) attrs.colwidth = colwidth
      else {
        const width = cp && first(cp, 'tcW')
        if (attr(width, 'type') === 'dxa')
          attrs.colwidth = Array.from({ length: span }, () => (Number(attr(width, 'w')) || 1440) / 15 / span)
      }
      const shading = cp && hex(attr(first(cp, 'shd'), 'fill'))
      if (shading) attrs.backgroundColor = shading
      const vertical = cp && attr(first(cp, 'vAlign'), 'val')
      if (vertical) attrs.verticalAlign = vertical === 'center' ? 'middle' : vertical
      const margins = cp && first(cp, 'tcMar')
      const padding = margins && attr(first(margins, 'top'), 'w')
      if (padding) attrs.padding = `${Number(padding) / 15}px`
      const cb = cp && first(cp, 'tcBorders')
      const tb = props && first(props, 'tblBorders')
      ;(['Top', 'Right', 'Bottom', 'Left'] as const).forEach((side) => {
        const edge = side.toLowerCase()
        const outside =
          side === 'Top'
            ? rowIndex === 0
            : side === 'Bottom'
              ? rowIndex === sourceRows.length - 1
              : side === 'Left'
                ? column === 0
                : column + span === widths.length
        const value = borderStyle(
          (cb && children(cb, edge)[0]) ||
            (tb && children(tb, outside ? edge : side === 'Top' || side === 'Bottom' ? 'insideH' : 'insideV')[0]),
        )
        if (value) attrs[`border${side}`] = value
      })
      const content = importBlocks(blocks(tc), rels, styles, new Map())
      const cell: DraftNode = {
        type: repeatHeader || (rowIndex === 0 && hasHeader) ? 'tableHeader' : 'tableCell',
        attrs,
        content: content.length ? content : [{ type: 'paragraph' }],
      }
      for (let i = 0; i < span; i++) active.delete(column + i)
      if (merge && attr(merge, 'val') === 'restart') active.set(column, cell)
      cells.push(cell)
      column += span
    }
    rows.push({ type: 'tableRow', attrs: { repeatHeader }, content: cells })
  })
  return {
    type: 'table',
    attrs: {
      style: `margin-left: ${alignment === 'center' || alignment === 'right' ? 'auto' : '0'}; margin-right: ${alignment === 'right' ? '0' : 'auto'}`,
    },
    content: rows,
  }
}

function scanUnsupported(xml: string): UnsupportedContent[] {
  const rules: Array<[RegExp, string]> = [
    [/<(?:\w+:)?chart\b/i, 'chart — could not be rendered'],
    [/<(?:\w+:)?smartArt\b|<dgm:/i, 'SmartArt'],
    [/<(?:\w+:)?shape\b|<v:shape/i, 'shape'],
    [/<(?:\w+:)?txbxContent\b/i, 'text box'],
    [/<(?:\w+:)?object\b|<o:OLEObject/i, 'embedded object'],
    [/<(?:\w+:)?(?:moveFrom|moveTo|customXmlInsRangeStart|customXmlDelRangeStart)\b/i, 'tracked change'],
    [/<(?:\w+:)?macros?\b/i, 'macro'],
  ]
  return rules.filter(([pattern]) => pattern.test(xml)).map(([, kind]) => ({ kind }))
}

function blocks(element: Element): Element[] {
  return children(element).flatMap((child) =>
    name(child) === 'sdt' ? blocks(first(child, 'sdtContent') || child) : [child],
  )
}

function tocSettings(instruction: string) {
  if (!/^\s*TOC\b/i.test(instruction)) return undefined
  const levels = /\\o\s+"([1-6])-([1-6])"/i.exec(instruction)
  const caption = /\\c\s+"([^"]+)"/i.exec(instruction)
  const remainder = instruction
    .replace(/^\s*TOC\b/i, '')
    .replace(/\\o\s+"[1-6]-[1-6]"/gi, '')
    .replace(/\\c\s+"[^"]+"/gi, '')
    .replace(/\\n(?:\s+"[1-6]-[1-6]")?/gi, '')
    .replace(/\\[hzu]\b/gi, '')
    .trim()
  const minLevel = Number(levels?.[1] || 1)
  const maxLevel = Number(levels?.[2] || 3)
  return !remainder && minLevel <= maxLevel && (!caption || validCaptionLabel(caption[1]))
    ? { minLevel, maxLevel, ...(caption ? { captionLabel: caption[1] } : {}) }
    : undefined
}

function fieldInstruction(paragraph: Element) {
  let instruction = ''
  for (const node of Array.from(paragraph.getElementsByTagName('*'))) {
    if (name(node) === 'fldChar' && attr(node, 'fldCharType') === 'separate') break
    if (name(node) === 'instrText') instruction += node.textContent || ''
  }
  return instruction
}

function isolatedTOC(elements: Element[], simple?: Element) {
  if (simple) return children(elements[0]).every((child) => child === simple || !first(child, 't')?.textContent?.trim())
  let depth = 0
  for (const paragraph of elements)
    for (const node of Array.from(paragraph.getElementsByTagName('*'))) {
      if (name(node) === 'fldChar') {
        if (attr(node, 'fldCharType') === 'begin') depth++
        if (attr(node, 'fldCharType') === 'end') depth--
        if (depth < 0) return false
      }
      if (name(node) === 't' && depth === 0 && node.textContent?.trim()) return false
    }
  return depth === 0
}

function cachedTOC(
  elements: Element[],
  settings: { minLevel: number; maxLevel: number; captionLabel?: string },
): DraftNode {
  const content: DraftNode[] = []
  for (const paragraph of elements) {
    const texts: string[] = []
    const page: string[] = []
    let afterTab = false
    for (const element of Array.from(paragraph.getElementsByTagName('*'))) {
      if (name(element) === 'tab' && element.parentNode?.nodeName.split(':').at(-1) === 'r') afterTab = true
      if (name(element) === 't') (afterTab ? page : texts).push(element.textContent || '')
    }
    const label = texts.join('').trim()
    if (!label) continue
    const link = Array.from(paragraph.getElementsByTagNameNS(word, 'hyperlink')).find((link) =>
      validTargetId(attr(link, 'anchor')),
    )
    const style = attr(first(paragraph, 'pStyle'), 'val') || ''
    const level =
      Number(/TOC\s*([1-6])/i.exec(style)?.[1]) ||
      Math.min(6, Math.max(1, Math.round((Number(paraAttrs(paragraph)?.indentLeft) || 0) / 12) + 1))
    content.push({
      type: 'tocEntry',
      attrs: {
        targetId: attr(link, 'anchor') || '',
        level,
        ...(page.length ? { pageNumber: page.join('').trim() } : {}),
      },
      content: [{ type: 'text', text: label }],
    })
  }
  return { type: 'tableOfContents', attrs: settings, content }
}

function importBlocks(elements: Element[], rels: DocxRelationships, styles: DocxStyles, numbering: Numbering) {
  const result: DraftNode[] = []
  const stack: DraftNode[] = []
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index]
    if (name(element) !== 'p') {
      stack.length = 0
      if (name(element) === 'tbl') result.push(tableNode(element, rels, styles))
      continue
    }
    const instruction = fieldInstruction(element)
    const simple = children(element, 'fldSimple').find((field) => /^\s*TOC\b/i.test(attr(field, 'instr') || ''))
    if (/^\s*TOC\b/i.test(instruction) || simple) {
      const settings = tocSettings(simple ? attr(simple, 'instr')! : instruction)
      let end = index
      let depth = 0
      let began = false
      if (!simple) {
        for (; end < elements.length; end++) {
          for (const field of Array.from(elements[end].getElementsByTagNameNS(word, 'fldChar'))) {
            const type = attr(field, 'fldCharType')
            if (type === 'begin') {
              depth++
              began = true
            }
            if (type === 'end') depth--
          }
          if (began && depth === 0) break
        }
      }
      const group = elements.slice(index, Math.min(end + 1, elements.length))
      // A standard TOC is an isolated field, with a cached result between begin/separate/end.
      const hasSeparate =
        simple ||
        group.some((p) =>
          Array.from(p.getElementsByTagNameNS(word, 'fldChar')).some(
            (field) => attr(field, 'fldCharType') === 'separate',
          ),
        )
      if (
        settings &&
        end < elements.length &&
        hasSeparate &&
        group.every((p) => name(p) === 'p') &&
        isolatedTOC(group, simple)
      )
        result.push(cachedTOC(group, settings))
      else {
        rels.unsupportedFields.add('TOC field (unsupported pattern)')
        for (const original of group) {
          const clone = original.cloneNode(true) as Element
          for (const field of Array.from(clone.getElementsByTagName('*')).filter((child) =>
            ['fldChar', 'instrText'].includes(name(child)),
          ))
            field.parentNode?.removeChild(field)
          for (const field of Array.from(clone.getElementsByTagNameNS(word, 'fldSimple'))) {
            while (field.firstChild) field.parentNode!.insertBefore(field.firstChild, field)
            field.parentNode!.removeChild(field)
          }
          if (name(clone) === 'tbl') result.push(tableNode(clone, rels, styles))
          else if (name(clone) === 'p') result.push(paragraphNode(clone, rels, styles))
        }
      }
      stack.length = 0
      index = Math.min(end, elements.length - 1)
      continue
    }
    const node = paragraphNode(element, rels, styles)
    const list = listInfo(element, numbering)
    if (list) appendList(result, node, list, stack)
    else {
      stack.length = 0
      result.push(node)
    }
  }
  return result
}

function importPageSetup(
  doc: Document,
  files: Record<string, Uint8Array>,
  unsupported: UnsupportedContent[],
  styles: DocxStyles,
) {
  const report = (kind: string) => unsupported.push({ kind })
  const sections = Array.from(doc.getElementsByTagNameNS(word, 'sectPr'))
  const section = sections[0]
  const page: PageSetup = { ...DEFAULT_PAGE_SETUP }
  const stories = emptyStories()
  if (files['docProps/core.xml']) {
    const core = parseXml(strFromU8(files['docProps/core.xml']), 'properties')
    stories.title = Array.from(core.getElementsByTagName('*')).find((node) => name(node) === 'title')?.textContent || ''
  }
  if (sections.length > 1) report('pageSetupMultipleSections')
  if (!section) return JSON.stringify({ ...page, stories: validateStories(stories) || emptyStories() })
  const size = children(section, 'pgSz')[0]
  const margins = children(section, 'pgMar')[0]
  page.width = int(attr(size, 'w')) ?? page.width
  page.height = int(attr(size, 'h')) ?? page.height
  page.orientation = attr(size, 'orient') === 'landscape' ? 'landscape' : 'portrait'
  for (const key of ['top', 'right', 'bottom', 'left', 'header', 'footer'] as const)
    page[key] = int(attr(margins, key)) ?? page[key]
  if (Number(attr(margins, 'gutter') || 0) !== 0) report('pageSetupGutter')
  const type = attr(children(section, 'type')[0], 'val')
  if (type && type !== 'nextPage') report('pageSetupSectionBreak')
  const numbering = children(section, 'pgNumType')[0]
  const format = attr(numbering, 'fmt') || 'decimal'
  if (['decimal', 'lowerRoman', 'upperRoman'].includes(format)) stories.format = format as Stories['format']
  else report('pageSetupNumbering')
  const start = int(attr(numbering, 'start')) ?? 1
  if (start >= 1 && start <= 32767) stories.start = start
  else report('pageSetupNumbering')
  if (attr(numbering, 'chapStyle')) report('pageSetupNumbering')
  const settings = files['word/settings.xml'] ? parseXml(strFromU8(files['word/settings.xml']), 'settings') : undefined
  const enabled = (node: Element | undefined) => !!node && !['0', 'false', 'off'].includes(attr(node, 'val') || 'true')
  if (settings && enabled(first(settings, 'mirrorMargins'))) report('pageSetupMirrored')
  stories.differentFirst = enabled(children(section, 'titlePg')[0])
  stories.differentEven = !!settings && enabled(first(settings, 'evenAndOddHeaders'))
  const rels = files['word/_rels/document.xml.rels']
    ? parseXml(strFromU8(files['word/_rels/document.xml.rels']), 'relationships')
    : undefined
  for (const kind of ['header', 'footer'] as const)
    for (const ref of children(section, `${kind}Reference`)) {
      const variant = attr(ref, 'type') || 'default'
      if (!['default', 'first', 'even'].includes(variant)) {
        report('pageSetupVariants')
        continue
      }
      const id = ref.getAttributeNS(relationships, 'id') || ref.getAttribute('r:id')
      const rel =
        rels && Array.from(rels.getElementsByTagName('Relationship')).find((rel) => rel.getAttribute('Id') === id)
      const target = rel?.getAttribute('Target') || ''
      const path = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`
      if (
        !rel ||
        rel.getAttribute('TargetMode') === 'External' ||
        !new RegExp(`^word/${kind}[^/]*\\.xml$`).test(path) ||
        !files[path] ||
        files[path].length > 2_000_000
      ) {
        report('pageSetupStories')
        continue
      }
      try {
        const story = parseXml(strFromU8(files[path]), kind)
        const storyRels = new DocxRelationships()
        storyRels.story = true
        const relPath = path.replace('word/', 'word/_rels/') + '.rels'
        if (files[relPath])
          for (const relationship of Array.from(
            parseXml(strFromU8(files[relPath]), 'story relationships').getElementsByTagName('Relationship'),
          )) {
            const rid = relationship.getAttribute('Id'),
              target = relationship.getAttribute('Target') || ''
            if (/\/hyperlink$/.test(relationship.getAttribute('Type') || '')) {
              const href = safeLink(target)
              if (rid && href) storyRels.set(rid, href)
              else report('pageSetupStories')
              continue
            }
            if (!rid || relationship.getAttribute('TargetMode') === 'External') {
              report('pageSetupStories')
              continue
            }
            if (/\/image$/.test(relationship.getAttribute('Type') || '')) {
              const imagePath = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`
              const bytes = /^word\/media\/[^/]+$/.test(imagePath) ? files[imagePath] : undefined
              const mime = bytes && bytes.length <= 50_000_000 && imageMime(bytes)
              if (bytes && mime)
                storyRels.images.set(
                  rid,
                  bytesToDataURL(
                    mime === 'image/svg+xml' ? new TextEncoder().encode(sanitizeSVG(strFromU8(bytes))) : bytes,
                    mime,
                  ),
                )
              else report('pageSetupStories')
            }
          }
        const root = story.documentElement
        if (children(root).some((node) => name(node) !== 'p')) report('pageSetupStories')
        const content = children(root, 'p').map((p) => ({ ...paragraphNode(p, storyRels, styles), type: 'paragraph' }))
        stories[kind][variant as StoryVariant] = content.length ? content : emptyStory()
        if (storyRels.unsupportedFields.size || storyRels.unsupportedImages.size) report('pageSetupStories')
      } catch {
        report('pageSetupStories')
      }
    }
  const validStories = validateStories(stories)
  if (validStories) page.stories = validStories
  else report('pageSetupStories')
  const validated = validatePageSetup(page)
  if (!validated) report('pageSetupInvalid')
  return JSON.stringify(validated || DEFAULT_PAGE_SETUP)
}

export function importDocx(bytes: ArrayBuffer | Uint8Array): ImportResult {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  } catch {
    throw new Error('The file is not a valid DOCX archive.')
  }
  const documentBytes = files['word/document.xml']
  if (!documentBytes) throw new Error('The DOCX file has no document.xml.')
  const documentXml = strFromU8(documentBytes)
  const doc = parseXml(documentXml, 'document')
  const stylesDoc = files['word/styles.xml'] ? parseXml(strFromU8(files['word/styles.xml']), 'styles') : undefined
  const styles = styleMap(stylesDoc)
  const parsedComments = parseComments(files)
  const numbering = files['word/numbering.xml']
    ? numberingMap(parseXml(strFromU8(files['word/numbering.xml']), 'numbering'))
    : new Map()
  const rels = new DocxRelationships()
  rels.commentIds = parsedComments.commentIds
  if (files['word/_rels/document.xml.rels']) {
    const relationshipsDoc = parseXml(strFromU8(files['word/_rels/document.xml.rels']), 'relationships')
    for (const item of Array.from(relationshipsDoc.getElementsByTagName('Relationship'))) {
      const id = item.getAttribute('Id')
      const target = item.getAttribute('Target')
      if (id && target) rels.set(id, target)
      loadChart(item, files, rels)
      if (id && target && /\/image$/.test(item.getAttribute('Type') || '')) {
        if (item.getAttribute('TargetMode') === 'External') {
          rels.unsupportedImages.add('external image')
          continue
        }
        const segments: string[] = []
        for (const part of (target.startsWith('/') ? target.slice(1) : `word/${target}`).split('/')) {
          if (part === '..') segments.pop()
          else if (part !== '.') segments.push(part)
        }
        const path = segments.join('/')
        const bytes = path.startsWith('word/media/') ? files[path] : undefined
        if (!bytes || bytes.length > 50_000_000) {
          rels.unsupportedImages.add('image (missing or too large)')
          continue
        }
        const mime = imageMime(bytes)
        if (!mime) {
          rels.unsupportedImages.add('image (unsupported format)')
          continue
        }
        try {
          rels.images.set(
            id,
            bytesToDataURL(
              mime === 'image/svg+xml' ? new TextEncoder().encode(sanitizeSVG(new TextDecoder().decode(bytes))) : bytes,
              mime,
            ),
          )
        } catch {
          rels.unsupportedImages.add('image (invalid SVG)')
        }
      }
    }
  }
  const body = first(doc, 'body')
  const result = body ? importBlocks(blocks(body), rels, styles, numbering) : []
  for (const kind of ['footnote', 'endnote'] as const) {
    const bytes = files[`word/${kind}s.xml`]
    if (!bytes) continue
    const notes = parseXml(strFromU8(bytes), `${kind}s`)
    const noteRels = new DocxRelationships()
    const relationshipsBytes = files[`word/_rels/${kind}s.xml.rels`]
    if (relationshipsBytes)
      for (const relationship of Array.from(
        parseXml(strFromU8(relationshipsBytes), `${kind} relationships`).getElementsByTagName('Relationship'),
      )) {
        const id = relationship.getAttribute('Id')
        const target = relationship.getAttribute('Target')
        if (id && target) noteRels.set(id, target)
        loadChart(relationship, files, noteRels)
      }
    for (const note of Array.from(notes.getElementsByTagNameNS(word, kind))) {
      const id = Number(attr(note, 'id'))
      if (!(id >= 0) || ['separator', 'continuationSeparator', 'continuationNotice'].includes(attr(note, 'type') || ''))
        continue
      const paragraphs = children(note, 'p').map((p) => ({ ...paragraphNode(p, noteRels, styles), type: 'paragraph' }))
      result.push({
        type: 'note',
        attrs: { id: `${kind}_${id}`, kind },
        content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }],
      })
      if (children(note).some((node) => !['p', 'customXmlPr'].includes(name(node))))
        rels.unsupportedFields.add(`${kind} non-paragraph content`)
    }
    for (const value of noteRels.unsupportedFields) rels.unsupportedFields.add(value)
    for (const value of noteRels.unsupportedImages) rels.unsupportedImages.add(value)
    rels.chartReports.push(...noteRels.chartReports)
  }
  const language =
    attr(first(doc, 'lang'), 'val') ||
    attr(first(doc, 'themeFontLang'), 'val') ||
    (stylesDoc && (attr(first(stylesDoc, 'lang'), 'val') || attr(first(stylesDoc, 'themeFontLang'), 'val')))
  const unsupported = scanUnsupported(documentXml).filter(
    (item) => !item.kind.startsWith('chart') || !rels.chartReports.length,
  )
  if (!parsedComments.threads.length && /<(?:\w+:)?comment(?:RangeStart|RangeEnd|Reference)\b/i.test(documentXml))
    unsupported.push({ kind: 'comment' })
  unsupported.push(...rels.chartReports)
  unsupported.push(...Array.from(rels.unsupportedImages, (kind) => ({ kind })))
  unsupported.push(...Array.from(rels.unsupportedFields, (kind) => ({ kind })))
  if (Object.keys(files).some((file) => /(?:vbaProject\.bin|macros)/i.test(file))) unsupported.push({ kind: 'macro' })
  if (Object.keys(files).some((file) => /word\/embeddings\//i.test(file))) unsupported.push({ kind: 'embedded object' })
  const columns = Math.max(1, Math.min(3, int(attr(first(doc, 'cols'), 'num')) || 1))
  const columnDefinition = first(doc, 'cols')
  if (
    columnDefinition &&
    (Number(attr(columnDefinition, 'num') || 1) > 3 ||
      ['0', 'false'].includes(attr(columnDefinition, 'equalWidth') || '') ||
      children(columnDefinition, 'col').length > 0 ||
      ['1', 'true'].includes(attr(columnDefinition, 'sep') || '') ||
      (columns > 1 && Number(attr(columnDefinition, 'space') || 720) !== 480))
  )
    unsupported.push({ kind: 'pageSetupColumns' })
  const pageSetup = importPageSetup(doc, files, unsupported, styles)
  let captionLabelSetting: string | undefined
  if (files['docProps/custom.xml'])
    try {
      const custom = parseXml(strFromU8(files['docProps/custom.xml']), 'custom properties')
      const setting = Array.from(custom.getElementsByTagName('*')).find(
        (node) => name(node) === 'property' && node.getAttribute('name') === 'AllSuiteCaptionLabels',
      )
      if (setting) {
        const labels = JSON.parse(setting.textContent || '')
        if (Array.isArray(labels) && labels.length <= 50 && labels.every(validCaptionLabel))
          captionLabelSetting = JSON.stringify(labels)
        else unsupported.push({ kind: 'caption labels (unsupported)' })
      }
    } catch {
      unsupported.push({ kind: 'caption labels (invalid)' })
    }
  const isObject = (node?: DraftNode) =>
    node?.type === 'table' || node?.content?.some((child) => child.type === 'image')
  result.forEach((node, index) => {
    if (node.attrs?.captionLabel)
      node.attrs.captionPosition =
        node.attrs.keepNext === true || (isObject(result[index + 1]) && !isObject(result[index - 1]))
          ? 'above'
          : 'below'
  })
  const captionIds = new Set<string>()
  const collectCaptions = (node: DraftNode) => {
    if (node.attrs?.captionLabel && validTargetId(node.attrs.anchorId)) captionIds.add(node.attrs.anchorId)
    node.content?.forEach(collectCaptions)
  }
  result.forEach(collectCaptions)
  const restoreNumberBookmarks = (node: DraftNode) => {
    if (node.type === 'crossReference' && node.attrs?.numberBookmark) {
      if (!captionIds.has(String(node.attrs.targetId)))
        node.attrs = {
          ...node.attrs,
          targetId: node.attrs.numberBookmark,
          format: node.attrs.format === 'page' ? 'page' : 'text',
        }
      delete node.attrs.numberBookmark
    }
    node.content?.forEach(restoreNumberBookmarks)
  }
  result.forEach(restoreNumberBookmarks)
  return {
    document: normalizeReferences({
      type: 'doc',
      attrs: {
        columns,
        ...(files['docProps/core.xml'] ? { coreProperties: strFromU8(files['docProps/core.xml']) } : {}),
        pageSetup,
        styleDefinitions: JSON.stringify([...styles.values()]),
        ...(parsedComments.threads.length ? { comments: serializeCommentThreads(parsedComments.threads) } : {}),
        ...(captionLabelSetting ? { captionLabels: captionLabelSetting } : {}),
      },
      content: result.length ? result : [{ type: 'paragraph' }],
    } as DraftDocument),
    language,
    unsupported: [...new Map(unsupported.map((item) => [item.kind, item])).values()],
  }
}
