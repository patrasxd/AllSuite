import type { DraftDocument, DraftNode } from '../document-model'
import { updateReferenceFields } from '../references'
import {
  cleanStyleFormat,
  paragraphFormat,
  paragraphStyleId,
  runFormat,
  styleHeading,
  stylesForDocument,
  type StyleFormat,
} from '../styles'
import { substituteFontFamily, type DocumentFontFamily } from '../fonts'
import { readPageSetup } from '../page-setup'

export type ExportFormat = 'markdown' | 'html' | 'text' | 'pdf'
export type ExportFont = {
  family: DocumentFontFamily
  weight: 400 | 700
  style: 'normal' | 'italic'
  subset: 'latin' | 'latin-ext'
  source: string
}
export type ExportOptions = {
  title?: string
  language?: string
  pageSize?: string
  orientation?: string
  fonts?: ExportFont[]
  fontLicense?: string
}
export const exportFontFamily = (value?: string): DocumentFontFamily =>
  substituteFontFamily(value || '') || (/mono/i.test(value || '') ? 'Cousine' : 'Arimo')
export const bounded = (value: unknown, fallback: number, min = 0, max = 1584) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
export const escapeHTML = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
export function exportContext(input: DraftDocument) {
  const document = updateReferenceFields(input)
  const styles = stylesForDocument(document)
  return {
    document,
    format: (node: DraftNode) => cleanStyleFormat(paragraphFormat(styles, node)),
    run: (node: DraftNode, base: StyleFormat) => cleanStyleFormat(runFormat(styles, node, base)),
    level: (node: DraftNode) =>
      node.type === 'heading' ? bounded(node.attrs?.level, 1, 1, 6) : styleHeading(styles, paragraphStyleId(node)),
  }
}
export function exportFontFamilies(input: DraftDocument) {
  const context = exportContext(input)
  const families = new Set<DocumentFontFamily>(['Arimo'])
  function visit(node: DraftNode, base: StyleFormat = {}) {
    if (node.type === 'codeBlock' || node.marks?.some((mark) => mark.type === 'code')) families.add('Cousine')
    if (node.type === 'paragraph' || node.type === 'heading') base = context.format(node)
    families.add(exportFontFamily(context.run(node, base).fontFamily))
    node.content?.forEach((child) => visit(child, base))
  }
  visit(context.document)
  const stories = readPageSetup(input).stories
  if (stories)
    for (const kind of ['header', 'footer'] as const)
      for (const nodes of Object.values(stories[kind])) nodes.forEach((node) => visit(node))
  return [...families]
}
export function inlineText(node: DraftNode): string {
  if (node.type === 'captionNumber')
    return `${node.attrs?.showLabel === false ? '' : String(node.attrs?.label || 'Figure') + ' '}${node.attrs?.number || 1}`
  if (node.type === 'tocEntry')
    return (node.content || []).map(inlineText).join('') + `\t${node.attrs?.pageNumber || '?'}`
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'pageBreak') return '\f'
  if (node.type === 'image') return node.attrs?.alt ? `[Image: ${node.attrs.alt}]` : '[Image]'
  if (node.type === 'crossReference') return String(node.attrs?.label || '[Missing reference]')
  if (node.type === 'noteReference') return `[${node.attrs?.kind === 'endnote' ? 'E' : ''}${node.attrs?.number || 1}]`
  return (node.content || []).map(inlineText).join('')
}
export function tableGrid(table: DraftNode): Array<Array<DraftNode | null>> {
  const grid: Array<Array<DraftNode | null>> = []
  for (const [rowIndex, row] of (table.content || []).entries()) {
    grid[rowIndex] ||= []
    let column = 0
    for (const cell of row.content || []) {
      while (grid[rowIndex][column] !== undefined) column++
      const colspan = Math.round(bounded(cell.attrs?.colspan, 1, 1, 100))
      const rowspan = Math.round(bounded(cell.attrs?.rowspan, 1, 1, 100))
      for (let y = 0; y < rowspan; y++)
        for (let x = 0; x < colspan; x++) {
          grid[rowIndex + y] ||= []
          grid[rowIndex + y][column + x] = y === 0 && x === 0 ? cell : null
        }
      column += colspan
    }
  }
  const width = Math.max(0, ...grid.map((row) => row.length))
  return grid.map((row) => Array.from({ length: width }, (_, index) => row[index] || null))
}
export function exportFileName(name: string, format: ExportFormat) {
  const clean = name.replace(/\.(docx|txt|md|html|pdf)$/i, '').replace(/[<>:"/\\|?*]/g, '_')
  const base =
    Array.from(clean, (character) => (character.charCodeAt(0) < 32 ? '_' : character))
      .join('')
      .trim() || 'Untitled'
  return `${base}.${format === 'markdown' ? 'md' : format === 'text' ? 'txt' : format}`
}
