import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { afterEach, expect, it, vi } from 'vitest'
import { editorExtensions } from '../editor/extensions'
import { LinkDialog, ReferenceTools, ReferencesDialog } from './ReferenceTools'
import { NavigationPanel } from './NavigationPanel'
import { normalizeReferences, updateReferenceFields } from '../engine/references'
import type { DraftDocument } from '../engine/document-model'

// Geometry is covered in the production browser tests; this component tests the async dialog lifecycle.
vi.mock('../browser/reference-layout', () => ({
  prepareReferenceExport: vi.fn(async (document: DraftDocument) => updateReferenceFields(document, { heading_2: '2' })),
}))

const editors: Editor[] = []
afterEach(() => {
  cleanup()
  editors.splice(0).forEach((editor) => editor.destroy())
})
function editorSetup() {
  const editor = new Editor({
    content: normalizeReferences({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'First section' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Nested section' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Final section' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
      ],
    }),
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
  })
  editors.push(editor)
  return editor
}
function LinkHarness({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <LinkDialog editor={editor} locale="en" open={open} onClose={() => setOpen(false)} />
      <ReferenceTools editor={editor} locale="en" onEditLink={() => setOpen(true)} />
    </>
  )
}
it('uses AllUI link inputs, validates the scheme, applies with Enter, edits and removes contextually', () => {
  const editor = editorSetup()
  editor.commands.setTextSelection({ from: 1, to: 6 })
  render(<LinkHarness editor={editor} />)
  const address = screen.getByRole('textbox', { name: 'Address' })
  expect(address.closest('.all-input-container')).toHaveClass('all-input-container--compact')
  fireEvent.change(address, { target: { value: 'javascript:alert(1)' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }))
  expect(screen.getByRole('alert')).toHaveTextContent('http, https, mailto, tel')
  fireEvent.change(address, { target: { value: 'https://example.test' } })
  fireEvent.keyDown(address, { key: 'Enter' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(editor.getHTML()).toContain('rel="noopener noreferrer"')
  expect(screen.getByRole('toolbar', { name: 'Reference tools' })).toBeInTheDocument()
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  fireEvent.click(screen.getByRole('button', { name: 'Open link' }))
  expect(open).toHaveBeenCalledWith('https://example.test', '_blank', 'noopener,noreferrer')
  open.mockRestore()
  fireEvent.click(screen.getByRole('button', { name: 'Edit link' }))
  expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue('https://example.test')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove link' }))
  expect(editor.isActive('link')).toBe(false)
  expect(screen.queryByRole('toolbar', { name: 'Reference tools' })).not.toBeInTheDocument()
})
it('localizes the reference picker, configures TOC levels and inserts a cached field', async () => {
  const editor = editorSetup()
  editor.commands.setTextSelection(editor.state.doc.content.size - 1)
  const close = vi.fn()
  render(<ReferencesDialog editor={editor} locale="pl" open onClose={close} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Typ odwołania' }), { target: { value: 'toc' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Pierwszy poziom nagłówków' }), { target: { value: '2' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Ostatni poziom nagłówków' }), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Wstaw', exact: true }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  const toc = editor.getJSON().content?.find((node) => node.type === 'tableOfContents')
  expect(toc).toMatchObject({
    attrs: { minLevel: 2, maxLevel: 2 },
    content: [{ type: 'tocEntry', content: [{ text: 'Nested section' }] }],
  })
})
it('collapses nested headings, highlights the selection section and jumps without changing document data', () => {
  const editor = editorSetup()
  const before = editor.getJSON()
  render(<NavigationPanel editor={editor} locale="en" open onClose={vi.fn()} />)
  const panel = screen.getByRole('navigation', { name: 'Outline' })
  expect(within(panel).getByRole('button', { name: 'First section', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  )
  fireEvent.click(within(panel).getByRole('button', { name: 'Collapse First section' }))
  expect(within(panel).queryByRole('button', { name: 'Nested section', exact: true })).not.toBeInTheDocument()
  fireEvent.click(within(panel).getByRole('button', { name: 'Expand First section' }))
  fireEvent.click(within(panel).getByRole('button', { name: 'Final section', exact: true }))
  expect(within(panel).getByRole('button', { name: 'Final section', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  )
  expect(editor.getJSON()).toEqual(before)
  act(() => editor.commands.setTextSelection(2))
  expect(within(panel).getByRole('button', { name: 'First section', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  )
})

it('edits an imported caption title without duplicating its bookmarked sequence prefix', () => {
  const editor = editorSetup()
  editor.commands.setContent({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Figure ' },
          {
            type: 'bookmark',
            attrs: { id: 'seq_result' },
            content: [{ type: 'captionNumber', attrs: { label: 'Figure', number: 1, showLabel: false } }],
          },
          { type: 'text', text: ': Synthetic caption' },
        ],
      },
    ],
  })
  editor.commands.setTextSelection(1)
  render(<ReferencesDialog editor={editor} locale="en" open onClose={vi.fn()} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Reference type' }), { target: { value: 'caption' } })
  expect(screen.getByRole('textbox', { name: 'Caption text' })).toHaveValue('Synthetic caption')
  fireEvent.change(screen.getByRole('textbox', { name: 'Caption text' }), { target: { value: 'Revised caption' } })
  fireEvent.click(screen.getByRole('button', { name: 'Insert', exact: true }))
  expect(editor.view.dom.querySelector('[data-draft-bookmark]')).toHaveAttribute('id', 'seq_result')
  expect(editor.getText()).toBe('Figure 1: Revised caption')
})
