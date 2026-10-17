import type { Node as PMNode } from '@tiptap/pm/model'

/** A text-only edit with unchanged block/document formatting and no floating objects. */
export function textBlockChange(before: PMNode, after: PMNode) {
  if (before.attrs !== after.attrs || before.childCount !== after.childCount) return
  const start = before.content.findDiffStart(after.content),
    end = before.content.findDiffEnd(after.content)
  if (start === null || !end) return
  const old = before.resolve(start),
    next = after.resolve(start)
  if (old.depth < 1 || old.depth !== next.depth || old.before() !== next.before()) return
  const previous = old.parent,
    node = next.parent
  if (
    !node.isTextblock ||
    node.type !== previous.type ||
    node.attrs !== previous.attrs ||
    previous.textContent === node.textContent ||
    end.a > old.end() ||
    end.b > next.end()
  )
    return
  let simple = true
  const contextMarks = old.nodeAfter?.marks || old.nodeBefore?.marks || []
  node.content.cut(start - next.start(), end.b - next.start()).forEach((child) => {
    if (child.marks.length !== contextMarks.length || child.marks.some((mark, index) => !mark.eq(contextMarks[index])))
      simple = false
  })
  for (const fragment of [
    previous.content.cut(start - old.start(), end.a - old.start()),
    node.content.cut(start - next.start(), end.b - next.start()),
  ])
    fragment.forEach((child) => {
      if (!child.isText) simple = false
    })
  for (const block of [previous, node])
    block.forEach((child) => {
      if (
        (!child.isText &&
          child.type.name !== 'hardBreak' &&
          !(child.type.name === 'image' && (!child.attrs.wrap || child.attrs.wrap === 'inline'))) ||
        child.marks.some((mark) => mark.type.name === 'characterStyle')
      )
        simple = false
    })
  if (simple) return { previous, node, pos: next.before() }
}
