import type { DraftDocument } from './document-model'
import { placeOnPage, type PageGeometry } from './pagination'

export const COLUMN_GAP = 32
export function columnCount(document: Pick<DraftDocument, 'attrs'>): number {
  return Math.max(1, Math.min(3, Number(document.attrs?.columns) || 1))
}

/** Only the text subset has measured column fragmentation. Never silently flatten atoms. */
export function supportsColumnLayout(document: DraftDocument): boolean {
  const allowed = new Set([
    'paragraph',
    'heading',
    'text',
    'hardBreak',
    'pageBreak',
    'bulletList',
    'orderedList',
    'listItem',
  ])
  const visit = (nodes: DraftDocument['content']): boolean =>
    nodes.every((node) => allowed.has(node.type) && (!node.content || visit(node.content)))
  return visit(document.content)
}

export function columnPosition(lane: number, count: number, stride: number, pitch: number) {
  return { x: (lane % count) * stride, y: (Math.floor(lane / count) - lane) * pitch }
}

export function placeInColumn(
  top: number,
  bottom: number,
  offset: number,
  geometry: PageGeometry,
  count: number,
  force?: 'always' | 'boundary',
  header = 0,
) {
  if (count === 1 || !force) return placeOnPage(top, bottom, offset, geometry, force, header)
  const y = top + offset
  const lane = Math.max(0, Math.floor((y + 0.25) / geometry.pitch))
  if (force === 'boundary' && lane % count === 0 && Math.abs(y - lane * geometry.pitch) < 0.75)
    return { offset, gap: 0, page: lane }
  const page = (Math.floor(lane / count) + 1) * count
  const gap = page * geometry.pitch - y
  return { offset: offset + gap, gap, page }
}
