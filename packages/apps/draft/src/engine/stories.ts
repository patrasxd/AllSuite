import type { DraftDocument, DraftNode } from './document-model'
import { safeImageSource } from './images'

export type StoryVariant = 'default' | 'first' | 'even'
export type StoryKind = 'header' | 'footer'
export interface Stories {
  differentFirst: boolean
  differentEven: boolean
  format: 'decimal' | 'lowerRoman' | 'upperRoman'
  start: number
  title: string
  header: Record<StoryVariant, DraftNode[]>
  footer: Record<StoryVariant, DraftNode[]>
}
export const emptyStory = (): DraftNode[] => [{ type: 'paragraph' }]
export function emptyStories(): Stories {
  return {
    differentFirst: false,
    differentEven: false,
    format: 'decimal',
    start: 1,
    title: '',
    header: { default: emptyStory(), first: emptyStory(), even: emptyStory() },
    footer: { default: emptyStory(), first: emptyStory(), even: emptyStory() },
  }
}
export function validateStories(value: unknown): Stories | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Stories
  if (
    typeof s.differentFirst !== 'boolean' ||
    typeof s.differentEven !== 'boolean' ||
    !['decimal', 'lowerRoman', 'upperRoman'].includes(s.format) ||
    !Number.isSafeInteger(s.start) ||
    s.start < 1 ||
    s.start > 32767 ||
    typeof s.title !== 'string' ||
    s.title.length > 1000
  )
    return null
  let count = 0
  const clean = (node: DraftNode, paragraph = false): DraftNode => {
    if (++count > 10000 || !node || typeof node !== 'object') throw new Error('Invalid story')
    if (paragraph) {
      if (node.type !== 'paragraph') throw new Error('Story paragraphs only')
      return { type: 'paragraph', attrs: node.attrs, content: (node.content || []).map((n) => clean(n)) }
    }
    if (node.type === 'text' && typeof node.text === 'string') return { ...node, content: undefined }
    if (node.type === 'hardBreak') return { type: 'hardBreak' }
    if (node.type === 'storyField' && ['PAGE', 'NUMPAGES', 'TITLE'].includes(String(node.attrs?.field)))
      return { type: 'storyField', attrs: { field: String(node.attrs!.field) }, marks: node.marks }
    if (node.type === 'image') {
      const src = safeImageSource(String(node.attrs?.src || ''))
      if (!src) throw new Error('Embedded images only')
      return {
        type: 'image',
        attrs: {
          ...node.attrs,
          src,
          fallbackSrc: node.attrs?.fallbackSrc ? safeImageSource(String(node.attrs.fallbackSrc)) : null,
          wrap: 'inline',
          width: Math.max(1, Math.min(16384, Number(node.attrs?.width) || 100)),
          height: Math.max(1, Math.min(16384, Number(node.attrs?.height) || 50)),
        },
      }
    }
    throw new Error('Unsupported story node')
  }
  try {
    const result = { ...s, header: { ...s.header }, footer: { ...s.footer } }
    for (const kind of ['header', 'footer'] as const)
      for (const variant of ['default', 'first', 'even'] as const) {
        const nodes = s[kind]?.[variant]
        if (!Array.isArray(nodes) || !nodes.length) return null
        result[kind][variant] = nodes.map((node) => clean(node, true))
      }
    return result
  } catch {
    return null
  }
}
export function storiesFor(page: {
  stories?: Stories
  headerText: string
  footerText: string
  pageNumbers: boolean
}): Stories {
  if (page.stories) return page.stories
  const s = emptyStories()
  if (page.headerText)
    s.header.default = [
      { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: page.headerText }] },
    ]
  if (page.footerText || page.pageNumbers)
    s.footer.default = [
      {
        type: 'paragraph',
        attrs: { textAlign: 'center' },
        content: [
          ...(page.footerText ? [{ type: 'text', text: page.footerText }] : []),
          ...(page.pageNumbers
            ? [
                { type: 'text', text: '  ' },
                { type: 'storyField', attrs: { field: 'PAGE' } },
                { type: 'text', text: ' / ' },
                { type: 'storyField', attrs: { field: 'NUMPAGES' } },
              ]
            : []),
        ],
      },
    ]
  return s
}
export function storyVariant(s: Stories, physicalPage: number): StoryVariant {
  return physicalPage === 1 && s.differentFirst
    ? 'first'
    : physicalPage % 2 === 0 && s.differentEven
      ? 'even'
      : 'default'
}
export function formatPage(number: number, format: Stories['format']): string {
  if (format === 'decimal' || number > 3999) return String(number)
  let value = number,
    result = ''
  for (const [n, roman] of [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ] as const)
    while (value >= n) {
      result += roman
      value -= n
    }
  return format === 'lowerRoman' ? result.toLowerCase() : result
}
export function resolveStory(nodes: DraftNode[], s: Stories, physicalPage: number, total: number): DraftDocument {
  const visit = (node: DraftNode): DraftNode =>
    node.type === 'storyField'
      ? {
          type: 'text',
          text:
            (node.attrs?.field === 'PAGE'
              ? formatPage(s.start + physicalPage - 1, s.format)
              : node.attrs?.field === 'NUMPAGES'
                ? String(total)
                : s.title) || '\u200b',
          marks: node.marks,
        }
      : { ...node, content: node.content?.map(visit) }
  return { type: 'doc', content: nodes.map(visit) }
}
/** Reserve a uniform body across variants; preserve at least 25.4 mm for body text. */
export function storyLayout(
  page: { height: number; top: number; bottom: number; header: number; footer: number },
  headerHeight: number,
  footerHeight: number,
) {
  const top = page.top / 15,
    bottom = page.bottom / 15
  const h = headerHeight ? Math.max(0, page.header / 15 + headerHeight + 8 - top) : 0
  const f = footerHeight ? Math.max(0, page.footer / 15 + footerHeight + 8 - bottom) : 0
  const ratio = Math.min(1, Math.max(0, page.height / 15 - top - bottom - 96) / (h + f || 1))
  return {
    top: top + h * ratio,
    bottom: bottom + f * ratio,
    headerScale: headerHeight ? Math.min(1, Math.max(0, top + h * ratio - page.header / 15 - 8) / headerHeight) : 1,
    footerScale: footerHeight ? Math.min(1, Math.max(0, bottom + f * ratio - page.footer / 15 - 8) / footerHeight) : 1,
  }
}
