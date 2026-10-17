import { afterEach, describe, expect, it } from 'vitest'
import { Editor, Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { CommentCleanup, CommentMark } from './comments'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('comment anchors', () => {
  it('removes a thread when its anchored text is deleted', () => {
    const id = 'comment-delete'
    const DocComments = Extension.create({
      name: 'testDocComments',
      addGlobalAttributes() {
        return [{ types: ['doc'], attributes: { comments: { default: null } } }]
      },
    })
    editor = new Editor({
      extensions: [StarterKit, DocComments, CommentMark, CommentCleanup],
      content: {
        type: 'doc',
        attrs: {
          comments: JSON.stringify([
            { id, author: 'Guest', text: 'Remove with this text', resolved: false, replies: [] },
          ]),
        },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'quoted text', marks: [{ type: 'comment', attrs: { id } }] }],
          },
        ],
      },
    })
    editor.commands.deleteRange({ from: 1, to: 12 })
    expect(editor.getText()).toBe('')
    expect(JSON.parse(String(editor.getJSON().attrs?.comments))).toEqual([])
  })
})
