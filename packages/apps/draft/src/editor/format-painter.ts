import type { Editor } from '@tiptap/core'

export type FormatSnapshot = {
  marks: Array<{ type: string; attrs?: Record<string, unknown> }>
  blockAttrs: Record<string, unknown>
}

export function captureFormatting(editor: Editor): FormatSnapshot | null {
  const { from, to, $from } = editor.state.selection
  if (from === to) return null
  let marks: FormatSnapshot['marks'] = []
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (node.isText && !marks.length) marks = node.marks.map((mark) => mark.toJSON())
  })
  return { marks, blockAttrs: { ...$from.parent.attrs } }
}

export function applyFormatting(editor: Editor, snapshot: FormatSnapshot) {
  const { from, to } = editor.state.selection
  if (from === to) return false
  let transaction = editor.state.tr.removeMark(from, to)
  for (const mark of snapshot.marks) {
    const type = editor.schema.marks[mark.type]
    if (type) transaction = transaction.addMark(from, to, type.create(mark.attrs))
  }
  editor.state.doc.nodesBetween(from, to, (node, position) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, ...snapshot.blockAttrs })
      return false
    }
    return true
  })
  editor.view.dispatch(transaction.scrollIntoView())
  return true
}
