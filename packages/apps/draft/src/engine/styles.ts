import type { DraftDocument, DraftNode } from './document-model'
import { normalizeHexColor } from './formatting'

export type StyleFormat = {
  keepNext?: boolean
  keepLines?: boolean
  widowControl?: boolean
  fontFamily?: string
  fontSize?: number
  color?: string
  bold?: boolean
  italic?: boolean
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  spacingBefore?: number
  spacingAfter?: number
  lineSpacing?: number
  indentLeft?: number
  indentRight?: number
  indentFirstLine?: number
  indentHanging?: number
}
export type DocumentStyle = {
  id: string
  name: string
  kind: 'paragraph' | 'character'
  basedOn?: string
  next?: string
  builtIn?: boolean
  heading?: number
  format: StyleFormat
}
export const paragraphStyleKeys = [
  'keepNext',
  'keepLines',
  'widowControl',
  'textAlign',
  'spacingBefore',
  'spacingAfter',
  'lineSpacing',
  'indentLeft',
  'indentRight',
  'indentFirstLine',
  'indentHanging',
] as const
export const defaultStyles: DocumentStyle[] = [
  {
    id: 'Normal',
    name: 'Normal',
    kind: 'paragraph',
    builtIn: true,
    next: 'Normal',
    format: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: 12,
      color: '#202020',
      bold: false,
      italic: false,
      textAlign: 'left',
      spacingBefore: 0,
      spacingAfter: 8,
      lineSpacing: 1.5,
      indentLeft: 0,
      indentRight: 0,
      indentFirstLine: 0,
      indentHanging: 0,
    },
  },
  ...[26, 22, 18, 16, 14, 12].map((fontSize, index): DocumentStyle => ({
    id: `Heading${index + 1}`,
    name: `Heading ${index + 1}`,
    kind: 'paragraph',
    builtIn: true,
    heading: index + 1,
    basedOn: 'Normal',
    next: 'Normal',
    format: { fontSize, bold: true, spacingBefore: 16, spacingAfter: 6, lineSpacing: 1.2 },
  })),
  {
    id: 'Title',
    name: 'Title',
    kind: 'paragraph',
    builtIn: true,
    basedOn: 'Normal',
    next: 'Subtitle',
    format: { fontSize: 32, spacingBefore: 0, spacingAfter: 10, lineSpacing: 1.15 },
  },
  {
    id: 'Subtitle',
    name: 'Subtitle',
    kind: 'paragraph',
    builtIn: true,
    basedOn: 'Normal',
    next: 'Normal',
    format: { fontSize: 16, color: '#505050', spacingAfter: 16 },
  },
  {
    id: 'Quote',
    name: 'Quote',
    kind: 'paragraph',
    builtIn: true,
    basedOn: 'Normal',
    next: 'Normal',
    format: { italic: true, indentLeft: 18, indentRight: 18, spacingBefore: 8 },
  },
  {
    id: 'Code',
    name: 'Code',
    kind: 'paragraph',
    builtIn: true,
    basedOn: 'Normal',
    next: 'Code',
    format: { fontFamily: 'Cousine', fontSize: 11, lineSpacing: 1.3, spacingAfter: 0 },
  },
  {
    id: 'ListParagraph',
    name: 'List Paragraph',
    kind: 'paragraph',
    builtIn: true,
    basedOn: 'Normal',
    next: 'ListParagraph',
    format: { spacingAfter: 4 },
  },
]

// Bound and allowlist imported definitions before they can reach CSS or an editor dialog.
export function cleanStyleFormat(input: unknown): StyleFormat {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  const result: StyleFormat = {}
  if (typeof value.fontFamily === 'string')
    result.fontFamily = value.fontFamily.replace(/[^\p{L}\p{N} ,._+-]/gu, '').slice(0, 160)
  if (typeof value.color === 'string' && normalizeHexColor(value.color)) result.color = normalizeHexColor(value.color)!
  for (const key of ['bold', 'italic', 'keepNext', 'keepLines', 'widowControl'] as const)
    if (typeof value[key] === 'boolean') result[key] = value[key]
  if (['left', 'center', 'right', 'justify'].includes(String(value.textAlign)))
    result.textAlign = value.textAlign as StyleFormat['textAlign']
  for (const key of [
    'fontSize',
    'spacingBefore',
    'spacingAfter',
    'lineSpacing',
    'indentLeft',
    'indentRight',
    'indentFirstLine',
    'indentHanging',
  ] as const) {
    const number = value[key]
    const min = key === 'fontSize' ? 6 : key === 'lineSpacing' ? 0.5 : 0
    const max = key === 'fontSize' ? 144 : key === 'lineSpacing' ? 10 : 1584
    if (typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max) result[key] = number
  }
  return result
}

export function readStyles(definitions: unknown): DocumentStyle[] {
  let input: unknown = definitions
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input)
    } catch {
      input = []
    }
  }
  const styles = new Map(defaultStyles.map((style) => [style.id, { ...style, format: { ...style.format } }]))
  if (Array.isArray(input))
    for (const item of input.slice(0, 512)) {
      if (
        !item ||
        typeof item.id !== 'string' ||
        !item.id ||
        item.id.length > 160 ||
        !['paragraph', 'character'].includes(item.kind)
      )
        continue
      styles.set(item.id, {
        id: item.id,
        name: String(item.name || item.id).slice(0, 160),
        kind: item.kind,
        basedOn: typeof item.basedOn === 'string' ? item.basedOn.slice(0, 160) : undefined,
        next: typeof item.next === 'string' ? item.next.slice(0, 160) : undefined,
        builtIn: item.builtIn === true,
        heading:
          item.kind === 'paragraph' && Number.isInteger(item.heading) && item.heading >= 1 && item.heading <= 6
            ? item.heading
            : undefined,
        format: cleanStyleFormat(item.format),
      })
    }
  return [...styles.values()]
}

export function resolveStyle(styles: DocumentStyle[], id: string, seen = new Set<string>()): StyleFormat {
  if (seen.has(id)) return {}
  const style = styles.find((entry) => entry.id === id)
  if (!style) return {}
  seen.add(id)
  return { ...(style.basedOn ? resolveStyle(styles, style.basedOn, seen) : {}), ...style.format }
}

export function styleHeading(styles: DocumentStyle[], id: string): number | undefined {
  const seen = new Set<string>()
  let style = styles.find((entry) => entry.id === id)
  while (style && !seen.has(style.id)) {
    if (style.heading) return style.heading
    seen.add(style.id)
    style = styles.find((entry) => entry.id === style?.basedOn)
  }
  return undefined
}

export function paragraphStyleId(node: Pick<DraftNode, 'type' | 'attrs'>) {
  return typeof node.attrs?.styleId === 'string'
    ? node.attrs.styleId
    : node.type === 'heading'
      ? `Heading${node.attrs?.level || 1}`
      : 'Normal'
}
export function paragraphFormat(styles: DocumentStyle[], node: Pick<DraftNode, 'type' | 'attrs'>): StyleFormat {
  const format = resolveStyle(styles, paragraphStyleId(node))
  for (const key of paragraphStyleKeys)
    if (node.attrs?.[key] !== null && node.attrs?.[key] !== undefined) Object.assign(format, { [key]: node.attrs[key] })
  return format
}
export function runFormat(styles: DocumentStyle[], node: Pick<DraftNode, 'marks'>, base: StyleFormat): StyleFormat {
  const character = node.marks?.find((mark) => mark.type === 'characterStyle')?.attrs?.styleId
  const result = { ...base, ...(typeof character === 'string' ? resolveStyle(styles, character) : {}) }
  for (const mark of node.marks || []) {
    if (mark.type === 'bold') result.bold = true
    if (mark.type === 'italic') result.italic = true
    if (mark.type === 'textStyle') {
      if (typeof mark.attrs?.fontFamily === 'string') result.fontFamily = mark.attrs.fontFamily
      if (typeof mark.attrs?.fontSize === 'string') result.fontSize = Number.parseFloat(mark.attrs.fontSize)
      if (typeof mark.attrs?.color === 'string') result.color = mark.attrs.color
      if (typeof mark.attrs?.styleBold === 'boolean') result.bold = mark.attrs.styleBold
      if (typeof mark.attrs?.styleItalic === 'boolean') result.italic = mark.attrs.styleItalic
    }
  }
  return result
}
export function stylesForDocument(document: DraftDocument) {
  return readStyles(document.attrs?.styleDefinitions)
}
