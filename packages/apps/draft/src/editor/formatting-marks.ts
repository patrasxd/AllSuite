import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const formattingMarksKey = new PluginKey<boolean>('draftFormattingMarks')

function decorations(state: EditorState) {
  const marks: Decoration[] = []
  state.doc.descendants((node, position) => {
    if (node.isText) {
      for (let index = 0; index < (node.text?.length || 0); index += 1) {
        const character = node.text?.[index]
        if (character === ' ')
          marks.push(Decoration.inline(position + index, position + index + 1, { class: 'draft-format-space' }))
        if (character === '\t')
          marks.push(Decoration.inline(position + index, position + index + 1, { class: 'draft-format-tab' }))
      }
    }
    if (node.isTextblock) {
      marks.push(
        Decoration.widget(position + node.nodeSize - 1, () => {
          const marker = document.createElement('span')
          marker.className = 'draft-format-paragraph'
          marker.textContent = '¶'
          marker.setAttribute('aria-hidden', 'true')
          return marker
        }),
      )
    }
  })
  return DecorationSet.create(state.doc, marks)
}

export const FormattingMarks = Extension.create({
  name: 'formattingMarks',
  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: formattingMarksKey,
        state: {
          init: () => false,
          apply(transaction, previous) {
            return transaction.getMeta(formattingMarksKey) ?? previous
          },
        },
        props: {
          decorations(state) {
            return formattingMarksKey.getState(state) ? decorations(state) : null
          },
        },
      }),
    ]
  },
})

export function setFormattingMarks(editor: Editor, visible: boolean) {
  editor.view.dispatch(editor.state.tr.setMeta(formattingMarksKey, visible))
}
