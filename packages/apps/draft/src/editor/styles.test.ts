import { Editor } from '@tiptap/core'
import { afterEach, expect, it, vi } from 'vitest'
import { editorExtensions } from './extensions'
import {
  applyDocumentStyle,
  clearDirectFormatting,
  editorStyles,
  saveStyle,
  selectionFormat,
  toggleStyleEmphasis,
} from './styles'
import { resolveStyle, readStyles } from '../engine/styles'
import { documentFontFamilies } from '../engine/fonts'
import type { DraftDocument } from '../engine/document-model'

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))
function setup(content = '<p>One</p><p>Two</p>') {
  const editor = new Editor({
    content,
    extensions: editorExtensions({ requestPlainPaste: vi.fn(), requestLink: vi.fn() }),
  })
  editors.push(editor)
  return editor
}
it('applies paragraph styles across a range, retains direct overrides and clears them independently', () => {
  const editor = setup()
  editor.commands.selectAll()
  editor.commands.setColor('#ff0000')
  editor.commands.setTextAlign('right')
  applyDocumentStyle(editor, 'Heading2')
  expect(editor.getJSON().content?.every((node) => node.type === 'heading' && node.attrs?.styleId === 'Heading2')).toBe(
    true,
  )
  expect(selectionFormat(editor)).toMatchObject({ fontSize: 22, color: '#ff0000', textAlign: 'right' })
  clearDirectFormatting(editor)
  expect(selectionFormat(editor)).toMatchObject({ fontSize: 22, color: '#202020', textAlign: 'left' })
  expect(editor.getJSON().content?.[0].attrs?.styleId).toBe('Heading2')
  expect(editor.getJSON().content?.[0].content?.[0].marks).toBeUndefined()
  applyDocumentStyle(editor, 'Normal')
  expect(editor.getJSON().content?.every((node) => node.type === 'paragraph')).toBe(true)
})
it('updates every use and descendant style, supports character styles and undo of style definitions', () => {
  const editor = setup()
  saveStyle(editor, { id: 'Base', name: 'Base', kind: 'paragraph', basedOn: 'Normal', format: { fontSize: 17 } })
  saveStyle(editor, {
    id: 'Child',
    name: 'Child',
    kind: 'paragraph',
    basedOn: 'Base',
    next: 'Normal',
    format: { spacingAfter: 14 },
  })
  saveStyle(editor, {
    id: 'Accent',
    name: 'Accent',
    kind: 'character',
    format: { color: '#123456', fontFamily: 'Cousine' },
  })
  editor.commands.selectAll()
  applyDocumentStyle(editor, 'Child')
  applyDocumentStyle(editor, 'Accent')
  expect(selectionFormat(editor)).toMatchObject({ fontSize: 17, color: '#123456', spacingAfter: 14 })
  clearDirectFormatting(editor)
  expect(editor.isActive('characterStyle', { styleId: 'Accent' })).toBe(true)
  saveStyle(editor, { id: 'Base', name: 'Base', kind: 'paragraph', basedOn: 'Normal', format: { fontSize: 24 } })
  expect(editor.view.dom.querySelectorAll('p')).toHaveLength(2)
  for (const node of editor.view.dom.querySelectorAll('p')) expect(node.style.fontSize).toBe('24pt')
  expect(documentFontFamilies(editor.getJSON() as DraftDocument)).toContain('Cousine')
  expect(editor.commands.undo()).toBe(true)
  expect(editorStyles(editor).find((style) => style.id === 'Base')?.format.fontSize).not.toBe(24)
})
it('turns inherited emphasis off and clearing direct formatting restores it', () => {
  const editor = setup('<p>Title</p>')
  editor.commands.selectAll()
  applyDocumentStyle(editor, 'Heading1')
  expect(selectionFormat(editor).bold).toBe(true)
  toggleStyleEmphasis(editor, 'bold')
  expect(selectionFormat(editor).bold).toBe(false)
  expect(editor.getJSON().content?.[0].content?.[0].marks).toContainEqual(
    expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ styleBold: false }) }),
  )
  clearDirectFormatting(editor)
  expect(selectionFormat(editor).bold).toBe(true)
})
it('inherits heading semantics and safely applies heading styles to paragraphs inside lists', () => {
  const editor = setup('<ul><li><p>List heading</p></li></ul>')
  saveStyle(editor, { id: 'Section', name: 'Section', kind: 'paragraph', basedOn: 'Heading2', format: {} })
  editor.commands.setTextSelection(3)
  expect(applyDocumentStyle(editor, 'Section')).toBe(true)
  expect(editor.getJSON().content?.[0].content?.[0].content?.[0]).toMatchObject({
    type: 'paragraph',
    attrs: { styleId: 'Section' },
  })
  expect(selectionFormat(editor).fontSize).toBe(22)
  editor.commands.setContent('<p>Section</p>')
  saveStyle(editor, { id: 'Section', name: 'Section', kind: 'paragraph', basedOn: 'Heading2', format: {} })
  applyDocumentStyle(editor, 'Section')
  expect(editor.getJSON().content?.[0].type).toBe('heading')
})
it('uses the next style on Enter and preserves the previous paragraph style', () => {
  const editor = setup('<p>Title</p>')
  editor.commands.setTextSelection(6)
  applyDocumentStyle(editor, 'Title')
  editor.view.someProp('handleKeyDown', (handler) =>
    handler(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })),
  )
  expect(editor.getJSON().content?.map((node) => node.attrs?.styleId)).toEqual(['Title', 'Subtitle'])
})
it('bounds imported formatting and terminates cyclic inheritance without rewriting definitions', () => {
  const styles = readStyles([
    {
      id: 'A',
      name: 'A',
      kind: 'paragraph',
      basedOn: 'B',
      format: { fontSize: 18, color: 'red;url(https://unsafe.test)', indentLeft: -100 },
    },
    { id: 'B', name: 'B', kind: 'paragraph', basedOn: 'A', format: { italic: true } },
  ])
  expect(resolveStyle(styles, 'A')).toEqual({ fontSize: 18, italic: true })
  expect(styles.find((style) => style.id === 'A')?.basedOn).toBe('B')
  expect(readStyles('{invalid')).toHaveLength(12)
})
