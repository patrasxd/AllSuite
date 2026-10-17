import { Extension, Node } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { DEFAULT_PAGE_SETUP, validatePageSetup, type PageSetup } from '../engine/page-setup'

export const DocumentPageSetup = Extension.create({
  name: 'documentPageSetup',
  addGlobalAttributes: () => [
    {
      types: ['doc'],
      attributes: {
        // A validated JSON string follows the document's existing styleDefinitions convention.
        pageSetup: { default: JSON.stringify(DEFAULT_PAGE_SETUP), rendered: false },
      },
    },
  ],
})
export function setPageSetup(editor: Editor, value: PageSetup) {
  const page = validatePageSetup(value)
  if (!page) return false
  const json = JSON.stringify(page)
  if (editor.state.doc.attrs.pageSetup === json) return true
  editor.view.dispatch(closeHistory(editor.state.tr.setDocAttribute('pageSetup', json)))
  return true
}
export const PageBreak = Node.create({
  name: 'pageBreak',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: false,
  addOptions: () => ({ label: (): string => 'Page break' }),
  parseHTML: () => [{ tag: 'span[data-page-break]' }],
  renderHTML() {
    return [
      'span',
      {
        'data-page-break': '',
        class: 'draft-page-break',
        contenteditable: 'false',
        'aria-label': this.options.label(),
      },
      '↡',
    ]
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.insertContent({ type: 'pageBreak' }) }
  },
})
