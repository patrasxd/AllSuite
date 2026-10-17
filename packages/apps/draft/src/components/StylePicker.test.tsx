import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../editor/extensions'
import { StylePicker } from './StylePicker'
import { saveStyle, applyDocumentStyle, selectionFormat } from '../editor/styles'

const editors: Editor[] = []
afterEach(() => {
  cleanup()
  editors.splice(0).forEach((editor) => editor.destroy())
})
function setup(locale: 'en' | 'pl' = 'en') {
  const editor = new Editor({
    content: '<p>First</p><p>Second</p>',
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
  })
  editors.push(editor)
  render(<StylePicker editor={editor} locale={locale} />)
  return editor
}
it('shows just one compact AllUI picker with the twelve default paragraph styles', () => {
  const editor = setup()
  expect(screen.getAllByRole('combobox')).toHaveLength(1)
  expect(screen.getAllByRole('option')).toHaveLength(12)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  const picker = screen.getByRole('combobox', { name: 'Text style' })
  expect(picker.closest('.all-select-container')).toHaveClass('all-select-container--compact')
  act(() => {
    editor.commands.selectAll()
    editor.commands.setColor('#123456')
  })
  fireEvent.change(picker, { target: { value: 'Heading3' } })
  expect(editor.getJSON().content?.every((node) => node.type === 'heading' && node.attrs?.styleId === 'Heading3')).toBe(
    true,
  )
  expect(selectionFormat(editor)).toMatchObject({ color: '#123456', fontSize: 18 })
  fireEvent.change(picker, { target: { value: 'Normal' } })
  expect(editor.getJSON().content?.every((node) => node.type === 'paragraph')).toBe(true)
})
it('localizes the defaults and identifies a currently applied imported style without management controls', () => {
  const editor = setup('pl')
  expect(screen.getByRole('option', { name: 'Nagłówek 6' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Akapit', exact: true })).toBeInTheDocument()
  act(() => {
    saveStyle(editor, { id: 'Imported', name: 'Imported body', kind: 'paragraph', format: { fontSize: 15 } })
    applyDocumentStyle(editor, 'Imported')
  })
  expect(screen.getByRole('combobox', { name: 'Styl tekstu' })).toHaveValue('Imported')
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
