import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { DraftDocument } from '../engine/document-model'
import { referenceTargets } from '../engine/references'

type HeadingLocation = {
  id: string
  level: number
  node: ProseMirrorNode
  parent: ProseMirrorNode
  parentPos: number
  index: number
  pos: number
}

function outlineLevels(editor: Editor) {
  return new Map(
    referenceTargets(editor.getJSON() as DraftDocument)
      .filter((target) => target.kind === 'heading')
      .map((target) => [target.id, target.level]),
  )
}

function headingLocations(editor: Editor, levels: Map<string, number>): HeadingLocation[] {
  const result: HeadingLocation[] = []
  const visit = (parent: ProseMirrorNode, parentPos: number) => {
    parent.forEach((node, offset, index) => {
      const pos = parentPos + 1 + offset
      const id = typeof node.attrs.anchorId === 'string' ? node.attrs.anchorId : ''
      const level = levels.get(id)
      if (level) result.push({ id, level, node, parent, parentPos, index, pos })
      visit(node, pos)
    })
  }
  visit(editor.state.doc, -1)
  return result
}

function sectionEnd(location: HeadingLocation, levels: Map<string, number>): number {
  let end = location.parentPos + 1 + location.parent.content.size
  location.parent.forEach((node, offset, index) => {
    if (index <= location.index) return
    const id = typeof node.attrs.anchorId === 'string' ? node.attrs.anchorId : ''
    const level = levels.get(id)
    if (level && level <= location.level && end === location.parentPos + 1 + location.parent.content.size)
      end = location.parentPos + 1 + offset
  })
  return end
}

function peer(location: HeadingLocation, direction: -1 | 1, levels: Map<string, number>): HeadingLocation | undefined {
  const items: Array<{ node: ProseMirrorNode; index: number; pos: number; id: string; level?: number }> = []
  location.parent.forEach((node, offset, index) => {
    const id = typeof node.attrs.anchorId === 'string' ? node.attrs.anchorId : ''
    items.push({ node, index, pos: location.parentPos + 1 + offset, id, level: levels.get(id) })
  })
  for (let index = location.index + direction; index >= 0 && index < items.length; index += direction) {
    const item = items[index]
    if (!item.level) continue
    if (item.level < location.level) return undefined
    if (item.level === location.level)
      return {
        id: item.id,
        level: item.level,
        node: item.node,
        parent: location.parent,
        parentPos: location.parentPos,
        index: item.index,
        pos: item.pos,
      }
  }
}

function move(editor: Editor, source: HeadingLocation, end: number, destination: number): boolean {
  if (destination >= source.pos && destination <= end) return false
  const fragment = editor.state.doc.slice(source.pos, end).content
  const tr = editor.state.tr.delete(source.pos, end)
  const insertAt = tr.mapping.map(destination, destination < source.pos ? -1 : 1)
  tr.insert(insertAt, fragment)
  editor.view.dispatch(tr)
  return true
}

export function outlineSectionMoves(editor: Editor): Map<string, { up: boolean; down: boolean }> {
  const levels = outlineLevels(editor)
  const headings = headingLocations(editor, levels)
  return new Map(
    headings.map((heading) => [
      heading.id,
      { up: Boolean(peer(heading, -1, levels)), down: Boolean(peer(heading, 1, levels)) },
    ]),
  )
}

export function moveOutlineSection(editor: Editor, id: string, direction: -1 | 1): boolean {
  const levels = outlineLevels(editor)
  const source = headingLocations(editor, levels).find((heading) => heading.id === id)
  if (!source) return false
  const adjacent = peer(source, direction, levels)
  if (!adjacent) return false
  const end = sectionEnd(source, levels)
  return direction < 0
    ? move(editor, source, end, adjacent.pos)
    : move(editor, source, end, sectionEnd(adjacent, levels))
}

export function moveOutlineSectionBefore(editor: Editor, sourceId: string, targetId: string): boolean {
  const levels = outlineLevels(editor)
  const headings = headingLocations(editor, levels)
  const source = headings.find((heading) => heading.id === sourceId)
  const target = headings.find((heading) => heading.id === targetId)
  if (!source || !target || source.id === target.id || source.parent !== target.parent || source.level !== target.level)
    return false
  return move(editor, source, sectionEnd(source, levels), target.pos)
}
