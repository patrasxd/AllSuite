import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DraftCodeBlock, normalizeCodeLanguage } from './code-block'

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('code blocks', () => {
  it('normalizes optional language labels', () => {
    expect(normalizeCodeLanguage('JS')).toBe('javascript')
    expect(normalizeCodeLanguage('python')).toBe('python')
    expect(normalizeCodeLanguage('made-up')).toBeNull()
    expect(normalizeCodeLanguage(undefined)).toBeNull()
  })

  it('lazy-loads the selected grammar and highlights tokens without changing the code text', async () => {
    editor = new Editor({
      extensions: [StarterKit.configure({ codeBlock: false, trailingNode: false }), DraftCodeBlock],
      content: {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'javascript' },
            content: [{ type: 'text', text: 'const answer = 42;' }],
          },
        ],
      },
    })
    document.body.appendChild(editor.view.dom)
    try {
      await vi.waitFor(() => expect(editor?.view.dom.querySelector('.draft-code-token--keyword')).not.toBeNull())
      expect(editor.view.dom.querySelector('pre')?.textContent).toBe('const answer = 42;')
      expect(editor.view.dom.querySelector('pre')?.getAttribute('data-language')).toBe('javascript')
    } finally {
      editor.view.dom.remove()
    }
  })
})
