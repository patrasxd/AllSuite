import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { editorExtensions } from '../editor/extensions'
import { ImageTools, ImageInsertDialog } from './ImageTools'
import { bytesToDataURL } from '../engine/images'
import { generatedPNG } from '../../../../../tests/fixtures/png'

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))
it('edits alt text in a keyboard-accessible AllUI dialog with Polish labels', () => {
  const editor = new Editor({
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'image',
              attrs: { src: bytesToDataURL(generatedPNG(), 'image/png'), width: 160, height: 80, alt: 'Before' },
            },
          ],
        },
      ],
    },
  })
  editors.push(editor)
  editor.commands.setNodeSelection(1)
  render(<ImageTools editor={editor} locale="pl" editAlt onEditAlt={vi.fn()} />)
  const field = screen.getByRole('textbox', { name: 'Tekst alternatywny' })
  expect(field.closest('.all-input-container')).toHaveClass('all-input-container--compact')
  fireEvent.change(field, { target: { value: 'Niebieski prostokąt' } })
  fireEvent.click(screen.getByRole('button', { name: 'Zastosuj' }))
  expect(editor.getAttributes('image').alt).toBe('Niebieski prostokąt')
})
it('uses compact AllUI inputs and exposes keep-original without storing image data', () => {
  const onOptions = vi.fn()
  render(
    <ImageInsertDialog
      open
      onClose={vi.fn()}
      locale="en"
      options={{ maxEdge: 2560, keepOriginal: false }}
      onOptions={onOptions}
      onInsert={vi.fn()}
      busy={false}
    />,
  )
  expect(
    screen.getByRole('spinbutton', { name: 'Maximum image edge (px)' }).closest('.all-input-container'),
  ).toHaveClass('all-input-container--compact')
  fireEvent.click(screen.getByRole('button', { name: 'Keep original' }))
  expect(onOptions).toHaveBeenCalledWith({ maxEdge: 2560, keepOriginal: true })
})
it('opens the native chooser from an AllUI button and shows the selected filename', async () => {
  const onInsert = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  render(
    <ImageInsertDialog
      open
      onClose={onClose}
      locale="en"
      options={{ maxEdge: 2560, keepOriginal: false }}
      onOptions={vi.fn()}
      onInsert={onInsert}
      busy={false}
    />,
  )
  const input = screen.getByLabelText('Image files')
  expect(input).not.toBeVisible()
  const click = vi.spyOn(input, 'click')
  const choose = screen.getByRole('button', { name: 'Choose images' })
  expect(choose).toHaveClass('all-btn')
  expect(choose.querySelector('svg')).toBeInTheDocument()
  fireEvent.click(choose)
  expect(click).toHaveBeenCalledOnce()
  const file = new File(['image'], 'landscape.png', { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
  expect(screen.getByRole('status')).toHaveTextContent('landscape.png')
  fireEvent.click(screen.getByRole('button', { name: 'Insert image', exact: true }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(onInsert).toHaveBeenCalledWith([file], '')
})
