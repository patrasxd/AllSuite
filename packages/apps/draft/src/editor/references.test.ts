import { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { afterEach, expect, it, vi } from 'vitest'
import { editorExtensions } from './extensions'
import { insertBookmark, insertNote, insertTOC, jumpToTarget, updateFields, insertCaption } from './references'
import { normalizeReferences } from '../engine/references'
import type { DraftDocument } from '../engine/document-model'
import { sanitizeClipboardHTML } from './paste'

const editors: Editor[] = []
it('inserts captions above/below objects and renumbers on reorder with undo', () => {
  const { editor } = setup('<p>Object A</p><p>Object B</p>')
  editor.commands.setTextSelection(2)
  expect(insertCaption(editor, 'Figure', 'Alpha', 'above')).toBe(true)
  expect(editor.getJSON().content?.[0]).toMatchObject({
    attrs: { captionLabel: 'Figure', captionPosition: 'above' },
    content: [
      { type: 'captionNumber', attrs: { number: 1 } },
      { type: 'text', text: ': Alpha' },
    ],
  })
  editor.commands.setTextSelection(editor.state.doc.content.size - 2)
  expect(insertCaption(editor, 'Figure', 'Beta', 'below')).toBe(true)
  const source = editor.getJSON() as DraftDocument
  const captions = source.content.filter((node) => node.attrs?.captionLabel)
  expect(captions.map((node) => node.content?.[0].attrs?.number)).toEqual([1, 2])
  editor.view.dispatch(closeHistory(editor.state.tr))
  editor.commands.setContent({
    type: 'doc',
    attrs: source.attrs,
    content: [captions[1], source.content[1], source.content[2], captions[0]],
  })
  expect(editor.getJSON().content?.[0]).toMatchObject({
    attrs: { anchorId: captions[1].attrs?.anchorId },
    content: [
      { type: 'captionNumber', attrs: { number: 1 } },
      { type: 'text', text: ': Beta' },
    ],
  })
  editor.commands.undo()
  expect(
    editor
      .getJSON()
      .content?.filter((node) => node.attrs?.captionLabel)
      .map((node) => node.content?.[1].text),
  ).toEqual([': Alpha', ': Beta'])
})

it('moves an existing caption around its adjacent table without changing its identity', () => {
  const { editor } = setup('<table><tbody><tr><td><p>Cell</p></td></tr></tbody></table><p>End</p>')
  editor.commands.setTextSelection(4)
  expect(insertCaption(editor, 'Table', 'Measurements', 'above')).toBe(true)
  const id = editor.getJSON().content?.[0].attrs?.anchorId
  editor.commands.setTextSelection(1)
  expect(insertCaption(editor, 'Table', 'Revised measurements', 'below')).toBe(true)
  expect(editor.getJSON().content?.[0].type).toBe('table')
  expect(editor.getJSON().content?.[1]).toMatchObject({ attrs: { anchorId: id, captionPosition: 'below' } })
  const tableSize = editor.state.doc.firstChild!.nodeSize
  editor.commands.setTextSelection(tableSize + 1)
  expect(insertCaption(editor, 'Table', 'Measurements', 'above')).toBe(true)
  expect(editor.getJSON().content?.[0]).toMatchObject({ attrs: { anchorId: id, captionPosition: 'above' } })
  expect(editor.getJSON().content?.[1].type).toBe('table')
})
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))
function setup(content = '<p>Selected words</p><p>End</p>') {
  const requestLink = vi.fn()
  const editor = new Editor({ content, extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink }) })
  editors.push(editor)
  return { editor, requestLink }
}
it('wraps selected bookmark text, rejects duplicates/multi-paragraph selections and jumps to the range', () => {
  const { editor } = setup()
  editor.commands.setTextSelection({ from: 1, to: 9 })
  expect(insertBookmark(editor, 'selection')).toBe(true)
  expect(editor.getJSON().content?.[0].content?.[0]).toMatchObject({
    type: 'bookmark',
    attrs: { id: 'selection' },
    content: [{ type: 'text', text: 'Selected' }],
  })
  expect(insertBookmark(editor, 'selection')).toBe(false)
  expect(jumpToTarget(editor, 'selection')).toBe(true)
  expect(editor.state.selection.from).toBe(2)
  editor.commands.selectAll()
  expect(insertBookmark(editor, 'whole')).toBe(false)
  expect(jumpToTarget(editor, 'missing')).toBe(false)
})
it('generates stable heading IDs, caches TOCs/REFs, then updates only the fields on demand', () => {
  const { editor } = setup()
  editor.commands.setTextSelection(1)
  editor.commands.setHeading({ level: 1 })
  const id = editor.getJSON().content?.[0].attrs?.anchorId
  expect(id).toBeTruthy()
  editor.commands.setTextSelection(editor.state.doc.content.size - 1)
  editor.commands.insertContent({ type: 'crossReference', attrs: { targetId: id, label: 'Old cached value' } })
  editor.commands.setTextSelection(editor.state.doc.content.size - 1)
  insertTOC(editor, 1, 3)
  const getTOC = () => editor.getJSON().content?.find((node) => node.type === 'tableOfContents')
  expect(getTOC()?.content?.[0].content?.[0].text).toBe('Selected words')
  editor.commands.insertContentAt(1, 'New ')
  expect(getTOC()?.content?.[0].content?.[0].text).toBe('Selected words')
  updateFields(editor)
  expect(getTOC()?.content?.[0].content?.[0].text).toBe('New Selected words')
  expect(JSON.stringify(editor.getJSON())).not.toContain('Old cached value')
  expect(editor.getJSON().content?.[0].attrs?.anchorId).toBe(id)
  editor.commands.undo()
  expect(getTOC()?.content?.[0].content?.[0].text).toBe('Selected words')
})
it('inserts editable notes, numbers them and restores note text when a deleted reference is undone', () => {
  const { editor } = setup('<p>Body</p>')
  editor.commands.setTextSelection(3)
  expect(insertNote(editor, 'footnote')).toBe(true)
  expect(editor.isActive('note')).toBe(true)
  editor.commands.insertContent('Source text')
  expect(insertNote(editor, 'endnote')).toBe(false)
  editor.view.dispatch(closeHistory(editor.state.tr))
  let referencePos = 0
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'noteReference') referencePos = pos
  })
  editor.commands.deleteRange({ from: referencePos, to: referencePos + 1 })
  expect(editor.getJSON().content?.some((node) => node.type === 'note')).toBe(false)
  editor.commands.undo()
  expect(JSON.stringify(editor.getJSON())).toContain('Source text')
  expect(editor.getJSON().content?.some((node) => node.type === 'note')).toBe(true)
  editor.commands.setTextSelection(1)
  insertNote(editor, 'footnote')
  const numbers: number[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'noteReference') numbers.push(node.attrs.number)
  })
  expect(numbers).toEqual([1, 2])
  expect(
    editor
      .getJSON()
      .content?.filter((node) => node.type === 'note')
      .map((node) => node.attrs?.number),
  ).toEqual([1, 2])
  const json = editor.getJSON() as DraftDocument
  expect(normalizeReferences(json)).toEqual(json)
})
it('opens the Ctrl+K dialog callback and sanitizes HTML and programmatic links', () => {
  const { editor, requestLink } = setup()
  editor.view.someProp('handleKeyDown', (handler) =>
    handler(editor.view, new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })),
  )
  expect(requestLink).toHaveBeenCalledOnce()
  editor.commands.setContent(
    sanitizeClipboardHTML(
      '<p><a href="javascript:alert(1)">Unsafe</a><a href="tel:+48123456789">Call</a><a href="#heading_1">Jump</a></p>',
    ),
  )
  expect(editor.getHTML()).not.toContain('javascript:')
  expect(editor.getHTML()).toContain('href="tel:+48123456789"')
  expect(editor.getHTML()).toContain('rel="noopener noreferrer"')
  editor.commands.setContent({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Bad', marks: [{ type: 'link', attrs: { href: 'data:text/html,bad' } }] }],
      },
    ],
  })
  expect(editor.getHTML()).not.toContain('href=')
  expect(JSON.stringify(editor.getJSON())).not.toContain('data:text/html')
})

it('exits bookmark boundaries with arrows and continues in a new paragraph on Enter', () => {
  const { editor } = setup('<p>Selected words</p>')
  editor.commands.setTextSelection({ from: 1, to: 15 })
  insertBookmark(editor, 'range')
  editor.commands.setTextSelection(16)
  editor.view.someProp('handleKeyDown', (handler) =>
    handler(editor.view, new KeyboardEvent('keydown', { key: 'ArrowRight' })),
  )
  expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
  editor.commands.setTextSelection(16)
  editor.view.someProp('handleKeyDown', (handler) =>
    handler(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })),
  )
  editor.commands.insertContent('Next paragraph')
  expect(editor.getJSON().content).toHaveLength(2)
  expect(editor.getJSON().content?.[0].content?.[0].content?.[0].text).toBe('Selected words')
  expect(editor.getJSON().content?.[1].content?.[0].text).toBe('Next paragraph')
})

it('keeps note destinations separate from user bookmark IDs', () => {
  const { editor } = setup('<p>Body</p>')
  editor.commands.setTextSelection(1)
  insertBookmark(editor, 'note-footnote_1')
  editor.commands.setTextSelection(editor.state.doc.content.size - 1)
  insertNote(editor, 'footnote')
  expect(jumpToTarget(editor, 'note:footnote_1')).toBe(true)
  expect(editor.isActive('note')).toBe(true)
  expect(jumpToTarget(editor, 'note-footnote_1')).toBe(true)
  expect(editor.isActive('bookmark')).toBe(true)
  expect(jumpToTarget(editor, 'ref:footnote_1')).toBe(true)
  expect(editor.isActive('note')).toBe(false)
  const ids = Array.from(editor.view.dom.querySelectorAll('[id]'), (node) => node.id)
  expect(new Set(ids).size).toBe(ids.length)
})
