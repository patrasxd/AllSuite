import { Editor } from '@tiptap/core'
import { afterEach, expect, it, vi } from 'vitest'
import { editorExtensions } from './extensions'
import { updatePagedFields } from './references'
import { prepareReferenceExport } from '../browser/reference-layout'
import { updateReferenceFields } from '../engine/references'
import type { DraftDocument } from '../engine/document-model'

vi.mock('../browser/reference-layout', () => ({ prepareReferenceExport: vi.fn() }))
const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach((editor) => {
    if (!editor.isDestroyed) editor.destroy()
  })
  vi.clearAllMocks()
})
function setup() {
  const editor = new Editor({
    extensions: editorExtensions({ requestPlainPaste: () => {}, requestLink: () => {} }),
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, anchorId: 'intro' }, content: [{ type: 'text', text: 'Introduction' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
        { type: 'tableOfContents', attrs: { minLevel: 1, maxLevel: 3 }, content: [] },
      ],
    },
  })
  editors.push(editor)
  return editor
}

it('applies computed page caches through one undoable main-document transaction', async () => {
  const editor = setup()
  editor.commands.setTextSelection(2)
  const caret = editor.state.selection.from
  vi.mocked(prepareReferenceExport).mockImplementation(async (input) => updateReferenceFields(input, { intro: '7' }))
  expect(await updatePagedFields(editor)).toBe(true)
  expect(editor.getJSON().content?.[2].content?.[0].attrs?.pageNumber).toBe('7')
  expect(editor.state.selection.from).toBe(caret)
  editor.commands.undo()
  expect(editor.getJSON().content?.[2].content).toBeUndefined()
})

it('discards a stale result when the user edits while pagination is measured', async () => {
  const editor = setup()
  let resolve!: (value: DraftDocument) => void
  vi.mocked(prepareReferenceExport).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const input = editor.getJSON() as DraftDocument
  const pending = updatePagedFields(editor)
  await vi.waitFor(() => expect(prepareReferenceExport).toHaveBeenCalledOnce())
  editor.commands.setTextSelection(2)
  editor.commands.insertContent('New text ')
  resolve(updateReferenceFields(input, { intro: '7' }))
  expect(await pending).toBe(false)
  expect(editor.getText()).toContain('New text')
  expect(editor.getJSON().content?.[2].content).toBeUndefined()
})

it('does not apply a result to a replaced or destroyed editor', async () => {
  const editor = setup()
  let resolve!: (value: DraftDocument) => void
  vi.mocked(prepareReferenceExport).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const input = editor.getJSON() as DraftDocument
  const pending = updatePagedFields(editor)
  await vi.waitFor(() => expect(prepareReferenceExport).toHaveBeenCalledOnce())
  editor.destroy()
  resolve(updateReferenceFields(input, { intro: '7' }))
  expect(await pending).toBe(false)
})
