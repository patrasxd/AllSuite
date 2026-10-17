import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DocumentPageSetup, PageBreak, setPageSetup } from './page-setup'
import { DEFAULT_PAGE_SETUP, readPageSetup } from '../engine/page-setup'
import { editorExtensions } from './extensions'
let editor: Editor
afterEach(() => editor?.destroy())
describe('document page transactions', () => {
  it('retains imported paragraph page breaks in the production schema and copied HTML', () => {
    editor = new Editor({
      extensions: editorExtensions({ requestPlainPaste() {}, requestLink() {} }),
      content: '<h2 style="break-before:page">Next</h2><p>Before<span data-page-break></span>After</p>',
    })
    expect(editor.getJSON().content?.[0].attrs?.pageBreakBefore).toBe(1)
    expect(editor.getHTML()).toContain('data-page-break-before="true"')
    expect(editor.getJSON().content?.[1].content?.some((node) => node.type === 'pageBreak')).toBe(true)
  })
  it('undoes page setup as document history and preserves selection/content', () => {
    editor = new Editor({ extensions: [StarterKit, DocumentPageSetup, PageBreak], content: '<p>Keep this text</p>' })
    editor.commands.setTextSelection(5)
    const next = { ...DEFAULT_PAGE_SETUP, left: 1500, pageNumbers: true }
    expect(setPageSetup(editor, next)).toBe(true)
    expect(editor.state.selection.from).toBe(5)
    expect(editor.getText()).toBe('Keep this text')
    expect(readPageSetup(editor.getJSON())).toEqual(next)
    expect(editor.commands.undo()).toBe(true)
    expect(readPageSetup(editor.getJSON())).toEqual(DEFAULT_PAGE_SETUP)
    expect(editor.commands.redo()).toBe(true)
    expect(readPageSetup(editor.getJSON())).toEqual(next)
    expect(setPageSetup(editor, { ...next, width: 0 })).toBe(false)
  })
})
