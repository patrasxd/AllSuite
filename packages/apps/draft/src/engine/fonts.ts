import type { DraftDocument, DraftNode } from './document-model'
import { paragraphStyleId, stylesForDocument } from './styles'
import { readPageSetup } from './page-setup'

export const SYSTEM_FONT_STACK = 'system-ui, sans-serif'

export const DOCUMENT_FONTS = [
  { family: 'Carlito', category: 'sans-serif' },
  { family: 'Caladea', category: 'serif' },
  { family: 'Arimo', category: 'sans-serif' },
  { family: 'Tinos', category: 'serif' },
  { family: 'Cousine', category: 'monospace' },
] as const

export type DocumentFontFamily = (typeof DOCUMENT_FONTS)[number]['family']

const substitutions: Record<string, DocumentFontFamily> = {
  calibri: 'Carlito',
  'calibri light': 'Carlito',
  cambria: 'Caladea',
  'cambria math': 'Caladea',
  arial: 'Arimo',
  'arial narrow': 'Arimo',
  'times new roman': 'Tinos',
  times: 'Tinos',
  'courier new': 'Cousine',
  courier: 'Cousine',
}

const categories = Object.fromEntries(DOCUMENT_FONTS.map(({ family, category }) => [family, category])) as Record<
  DocumentFontFamily,
  string
>

function firstFamily(value: string) {
  return value
    .split(',')[0]
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
}

export function substituteFontFamily(original: string): DocumentFontFamily | undefined {
  const family = firstFamily(original)
  return (
    DOCUMENT_FONTS.find((item) => item.family.toLowerCase() === family.toLowerCase())?.family ||
    substitutions[family.toLowerCase()]
  )
}

export function renderFontFamily(original: string) {
  if (original === SYSTEM_FONT_STACK) return SYSTEM_FONT_STACK
  const substitute = substituteFontFamily(original)
  if (substitute) return `"${substitute}", ${categories[substitute]}`
  const safeOriginal = firstFamily(original)
    .replace(/[^\p{L}\p{N} ._+-]/gu, '')
    .trim()
  return safeOriginal ? `"${safeOriginal}", ${SYSTEM_FONT_STACK}` : SYSTEM_FONT_STACK
}

export function fontPickerValue(original?: string) {
  if (!original || original === SYSTEM_FONT_STACK) return SYSTEM_FONT_STACK
  return substituteFontFamily(original) || SYSTEM_FONT_STACK
}

function fontFamilies(node: DraftNode, result: Set<DocumentFontFamily>) {
  for (const mark of node.marks || []) {
    if (mark.type !== 'textStyle' || typeof mark.attrs?.fontFamily !== 'string') continue
    const family = substituteFontFamily(mark.attrs.fontFamily)
    if (family) result.add(family)
  }
  for (const child of node.content || []) fontFamilies(child, result)
}

export function documentFontFamilies(document: DraftDocument) {
  const result = new Set<DocumentFontFamily>()
  fontFamilies(document, result)
  const stories = readPageSetup(document).stories
  if (stories)
    for (const kind of ['header', 'footer'] as const)
      for (const nodes of Object.values(stories[kind])) for (const node of nodes) fontFamilies(node, result)
  const styles = stylesForDocument(document)
  const used = new Set<string>()
  function addStyle(id: string) {
    if (used.has(id)) return
    used.add(id)
    const style = styles.find((entry) => entry.id === id)
    const family = style?.format.fontFamily && substituteFontFamily(style.format.fontFamily)
    if (family) result.add(family)
    if (style?.basedOn) addStyle(style.basedOn)
  }
  function visit(node: DraftNode) {
    if (node.type === 'paragraph' || node.type === 'heading') addStyle(paragraphStyleId(node))
    for (const mark of node.marks || [])
      if (mark.type === 'characterStyle' && typeof mark.attrs?.styleId === 'string') addStyle(mark.attrs.styleId)
    for (const child of node.content || []) visit(child)
  }
  visit(document)
  if (stories)
    for (const kind of ['header', 'footer'] as const)
      for (const nodes of Object.values(stories[kind])) nodes.forEach(visit)
  return [...result]
}

const loaders: Record<DocumentFontFamily, () => Promise<unknown>> = {
  Carlito: () => import('../fonts/carlito.css'),
  Caladea: () => import('../fonts/caladea.css'),
  Arimo: () => import('../fonts/arimo.css'),
  Tinos: () => import('../fonts/tinos.css'),
  Cousine: () => import('../fonts/cousine.css'),
}

const pendingLoads = new Map<DocumentFontFamily, Promise<void>>()

export function loadDocumentFont(font: string) {
  const family = substituteFontFamily(font)
  if (!family) return Promise.resolve()
  let pending = pendingLoads.get(family)
  if (!pending) {
    pending = loaders[family]().then(() => undefined)
    pendingLoads.set(family, pending)
  }
  return pending
}

export async function loadDocumentFonts(document: DraftDocument) {
  await Promise.all(documentFontFamilies(document).map(loadDocumentFont))
}
