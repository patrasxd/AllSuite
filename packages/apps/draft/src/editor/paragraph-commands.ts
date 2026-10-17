import type { Editor } from '@tiptap/core'
import type { ParagraphAttributes } from '../engine/paragraph'
import { paragraphFormat } from '../engine/styles'
import { editorStyles } from './styles'

export function selectedParagraphAttributes(editor: Editor): Partial<ParagraphAttributes> {
  const node = editor.state.selection.$from.parent
  return node.type.name === 'paragraph' || node.type.name === 'heading'
    ? {
        ...paragraphFormat(editorStyles(editor), { type: node.type.name, attrs: node.attrs }),
        ...Object.fromEntries(Object.entries(node.attrs).filter(([, value]) => value !== null)),
      }
    : {}
}

export function updateSelectedParagraphs(editor: Editor, attrs: Partial<ParagraphAttributes>) {
  const { from, to } = editor.state.selection
  const transaction = editor.state.tr
  editor.state.doc.nodesBetween(from, to, (node, position) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, ...attrs })
      return false
    }
    return true
  })
  if (!transaction.docChanged) return false
  editor.view.dispatch(transaction.scrollIntoView())
  return true
}

export function setDocumentColumns(editor: Editor, columns: number) {
  editor.view.dispatch(editor.state.tr.setDocAttribute('columns', Math.max(1, Math.min(3, columns))))
}
