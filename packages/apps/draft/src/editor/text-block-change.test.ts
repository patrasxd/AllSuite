import { Editor } from '@tiptap/core'
import { expect, it, vi } from 'vitest'
import { editorExtensions } from './extensions'
import { textBlockChange } from './text-block-change'

it('reuses only unchanged block formatting for local text and rejects mark/structural changes', () => {
  const editor = new Editor({
    content: '<p>Original</p>',
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
  })
  try {
    const before = editor.state.doc
    expect(textBlockChange(before, editor.state.tr.insertText('x', 3).doc)?.pos).toBe(0)
    expect(
      textBlockChange(before, editor.state.tr.addMark(1, 4, editor.schema.marks.bold.create()).doc),
    ).toBeUndefined()
    expect(textBlockChange(before, editor.state.tr.split(3).doc)).toBeUndefined()
    expect(textBlockChange(before, editor.state.tr.setDocAttribute('columns', 2).doc)).toBeUndefined()
    expect(
      textBlockChange(
        before,
        editor.state.tr.insert(
          3,
          editor.schema.text('new', [editor.schema.marks.textStyle.create({ fontFamily: 'Carlito' })]),
        ).doc,
      ),
    ).toBeUndefined()
  } finally {
    editor.destroy()
  }
})
