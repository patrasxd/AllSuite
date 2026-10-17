import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { editorExtensions } from '../editor/extensions'
import { FindReplacePanel } from './FindReplacePanel'

const editors: Editor[] = []

afterEach(() => {
  cleanup()
  for (const editor of editors.splice(0)) editor.destroy()
})

function setup() {
  const editor = new Editor({
    content: '<p><strong>Hel</strong><em>lo</em> hello</p>',
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
  })
  editors.push(editor)
  render(
    <>
      <FindReplacePanel editor={editor} locale="en" mode="replace" onModeChange={vi.fn()} onClose={vi.fn()} />
      <EditorContent editor={editor} />
    </>,
  )
  return editor
}

describe('find and replace panel', () => {
  it('finds across formatted runs, navigates, highlights and replaces without mutating during search', async () => {
    const editor = setup()
    const original = editor.getJSON()
    fireEvent.change(screen.getByRole('textbox', { name: 'Find' }), { target: { value: 'hello' } })
    await screen.findByText('1/2')
    expect(editor.getJSON()).toEqual(original)
    expect(editor.view.dom.querySelectorAll('.draft-search-match').length).toBeGreaterThanOrEqual(2)
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('hello')
    fireEvent.change(screen.getByRole('textbox', { name: 'Replace with' }), { target: { value: 'world' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace current' }))
    await waitFor(() => expect(editor.getText()).toBe('Hello world'))
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }))
    await waitFor(() => expect(editor.getText()).toBe('world world'))
  })

  it('shows a safe error for invalid and unsafe regular expressions', async () => {
    setup()
    fireEvent.click(screen.getByRole('switch', { name: 'Regular expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Find' }), { target: { value: '[' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid')
    fireEvent.change(screen.getByRole('textbox', { name: 'Find' }), { target: { value: '(a+)+$' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('too complex')
  })
})
